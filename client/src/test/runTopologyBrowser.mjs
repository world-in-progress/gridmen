import { constants } from 'node:fs'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hardware = process.env.GRID_TEST_ANGLE === 'metal'
const selectionSide = Number(process.argv[2] ?? 256)
if (!Number.isSafeInteger(selectionSide) || selectionSide < 256 || selectionSide > 1024 || (selectionSide & (selectionSide - 1)) !== 0) {
  throw new Error('Expected a selection patch side of 256, 512, or 1024')
}
const temporary = await mkdtemp(join(tmpdir(), 'gridmen-browser-'))

async function findChrome() {
  if (process.env.CHROME_BIN) {
    await access(process.env.CHROME_BIN, constants.X_OK)
    return process.env.CHROME_BIN
  }
  const names = process.platform === 'win32' ? ['chrome.exe'] : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
  const candidates = (process.env.PATH ?? '').split(delimiter).filter(Boolean).flatMap(path => names.map(name => join(path, name)))
  if (process.platform === 'darwin') {
    for (const path of ['/Applications', join(homedir(), 'Applications')]) {
      candidates.push(join(path, 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'))
    }
  } else if (process.platform === 'win32') {
    for (const path of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean)) {
      candidates.push(join(path, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    }
  }
  for (const path of candidates) {
    try { await access(path, constants.X_OK); return path }
    catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error }
  }
  throw new Error('Chrome was not found on PATH or in its platform installation directory; set CHROME_BIN to its executable.')
}

let chrome, server, ws, closed
const pending = new Map(), messages = []
let id = 0
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const requestId = ++id
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`DevTools ${method} timed out`)) }, 10000)
    pending.set(requestId, { resolve, reject, timer })
    ws.send(JSON.stringify({ id: requestId, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
}

try {
  const bundle = async entry => (await build({ entryPoints: [resolve(root, entry)], bundle: true, platform: 'browser',
    format: 'esm', target: 'chrome120', write: false, define: { 'import.meta.env': '{}' },
    tsconfig: resolve(root, 'tsconfig.app.json'), logLevel: 'warning' })).outputFiles[0].contents
  const fixture = await bundle('test/topologyLayer.browser.ts')
  const worker = await bundle('src/core/worker/displayGeometry.worker.ts')
  const shader = await readFile(resolve(root, 'public/shaders/patch/display.glsl'))
  const html = '<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#182025;color:#eee;font:14px monospace}#gl{width:512px;height:512px;display:block}#result{white-space:pre-wrap}</style></head><body><div><canvas id="gl" width="512" height="512"></canvas></div><pre id="result">running</pre><script type="module" src="/fixture.js"></script></body></html>'
  const routes = new Map([
    ['/', [html, 'text/html']], ['/fixture.js', [fixture, 'text/javascript']],
    ['/displayGeometry.worker.ts', [worker, 'text/javascript']], ['/shaders/patch/display.glsl', [shader, 'text/plain']],
  ])
  server = createServer((req, res) => {
    const path = new URL(req.url, 'http://127.0.0.1').pathname
    if (path === '/favicon.ico') { res.writeHead(204); res.end(); return }
    const route = routes.get(path)
    if (!route) { res.writeHead(404); res.end(); return }
    res.setHeader('Content-Type', route[1]); res.end(route[0])
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  chrome = spawn(await findChrome(), [
    ...(hardware ? ['--use-angle=metal'] : ['--headless=new', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader']),
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-extensions', '--disable-sync', '--disable-gpu-sandbox',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--remote-debugging-port=0', '--window-size=640,640', `--user-data-dir=${join(temporary, 'profile')}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  closed = new Promise(resolve => chrome.once('close', resolve))
  const endpoint = await new Promise((resolve, reject) => {
    let stderr = ''
    const timer = setTimeout(() => reject(new Error('No DevTools endpoint')), 10000)
    chrome.once('error', error => { clearTimeout(timer); reject(error) })
    chrome.stderr.on('data', data => {
      stderr += data
      const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/)
      if (match) { clearTimeout(timer); resolve(match[1]) }
    })
  })
  ws = new WebSocket(endpoint)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  ws.onclose = () => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('DevTools connection closed')) }
    pending.clear()
  }
  ws.onmessage = event => {
    const message = JSON.parse(event.data), callback = pending.get(message.id)
    if (callback) {
      pending.delete(message.id); clearTimeout(callback.timer)
      if (message.error) callback.reject(new Error(JSON.stringify(message.error)))
      else callback.resolve(message.result)
    } else if (message.method === 'Runtime.exceptionThrown' || message.method === 'Runtime.consoleAPICalled') messages.push(message)
  }
  if (hardware) {
    const { gpu } = await send('SystemInfo.getInfo')
    if (!gpu.devices.some(device => /Metal/.test(device.deviceString))) throw new Error('ANGLE Metal is unavailable')
    console.log(JSON.stringify({ gpu: { devices: gpu.devices, featureStatus: gpu.featureStatus } }, null, 2))
  }
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Runtime.enable', {}, sessionId)
  await send('Page.enable', {}, sessionId)
  await send('Page.bringToFront', {}, sessionId)
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/?selectionSide=${selectionSide}` }, sessionId)
  const timeoutMs = selectionSide === 1024 ? 180000 : 45000
  const deadline = Date.now() + timeoutMs
  let done = false
  while (Date.now() < deadline) {
    const { result } = await send('Runtime.evaluate', { expression: 'document.documentElement.dataset.done === "true"', returnByValue: true }, sessionId)
    if (result.value === true) { done = true; break }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const { result } = await send('Runtime.evaluate', { expression: 'document.querySelector("#result")?.textContent', returnByValue: true }, sessionId)
  if (!done) throw new Error(`Fixture did not finish within ${timeoutMs / 1000}s: ${result.value}`)
  const report = JSON.parse(result.value)
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok || messages.some(message => message.method === 'Runtime.exceptionThrown')) {
    console.error(JSON.stringify(messages, null, 2)); process.exitCode = 1
  }
  await send('Browser.close')
  await closed
} finally {
  ws?.close()
  if (chrome?.exitCode === null) { chrome.kill('SIGTERM'); await closed }
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(temporary, { recursive: true, force: true })
}
