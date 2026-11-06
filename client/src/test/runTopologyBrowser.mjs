import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const evidence = resolve(process.env.GRID_TEST_EVIDENCE ?? resolve(root, '../../.verification/topology-browser'))
await mkdir(evidence, { recursive: true })
await build({ entryPoints: [resolve(root, 'test/topologyLayer.browser.ts')], bundle: true, platform: 'browser',
  format: 'esm', target: 'chrome120', outfile: resolve(evidence, 'topologyLayer.bundle.js'),
  define: { 'import.meta.env': '{}' }, tsconfig: resolve(root, 'tsconfig.app.json'), logLevel: 'warning' })
const html = '<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#182025;color:#eee;font:14px monospace}#gl{width:512px;height:512px;display:block}#result{white-space:pre-wrap}</style></head><body><div><canvas id="gl" width="512" height="512"></canvas></div><pre id="result">running</pre><script type="module" src="/fixture.js"></script></body></html>'
const server = createServer(async (req, res) => {
  if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return }
  if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return }
  const route = new Map([
    ['/fixture.js', [resolve(evidence, 'topologyLayer.bundle.js'), 'text/javascript']],
    ['/shaders/patch/display.glsl', [resolve(root, 'public/shaders/patch/display.glsl'), 'text/plain']],
  ]).get(req.url)
  if (!route) { res.writeHead(404); res.end(); return }
  res.setHeader('Content-Type', route[1]); res.end(await readFile(route[0]))
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--disable-extensions', '--disable-sync', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader',
  '--disable-gpu-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows', '--remote-debugging-port=0', '--window-size=640,640',
  `--user-data-dir=${resolve(evidence, 'chrome-profile')}`, 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] })
let stderr = '', stdout = '', ws
const closed = new Promise(resolve => chrome.once('close', resolve))
chrome.stdout.on('data', data => { stdout += data })
const endpoint = new Promise((r, reject) => {
  const timeout = setTimeout(() => reject(new Error('No DevTools endpoint')), 10000)
  chrome.once('error', reject)
  chrome.stderr.on('data', data => {
    stderr += data
    const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/)
    if (match) { clearTimeout(timeout); r(match[1]) }
  })
})
const messages = [], pending = new Map()
let id = 0
function send(method, params = {}, sessionId) {
  return new Promise((r, reject) => {
    const requestId = ++id
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`DevTools ${method} timed out`)) }, 10000)
    pending.set(requestId, { r, reject, timer })
    ws.send(JSON.stringify({ id: requestId, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
}
try {
  ws = new WebSocket(await endpoint)
  await new Promise((r, reject) => { ws.onopen = r; ws.onerror = reject })
  ws.onclose = () => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('DevTools connection closed')) }
    pending.clear()
  }
  ws.onmessage = event => {
    const message = JSON.parse(event.data)
    const callback = pending.get(message.id)
    if (callback) {
      pending.delete(message.id)
      clearTimeout(callback.timer)
      if (message.error) callback.reject(new Error(JSON.stringify(message.error)))
      else callback.r(message.result)
    } else if (message.method === 'Runtime.exceptionThrown' || message.method === 'Runtime.consoleAPICalled') messages.push(message)
  }
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Runtime.enable', {}, sessionId)
  await send('Page.enable', {}, sessionId)
  await send('Page.bringToFront', {}, sessionId)
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` }, sessionId)
  const deadline = Date.now() + 45000
  let done = false
  while (Date.now() < deadline) {
    const { result } = await send('Runtime.evaluate', { expression: 'document.documentElement.dataset.done === "true"', returnByValue: true }, sessionId)
    if (result.value === true) { done = true; break }
    await new Promise(r => setTimeout(r, 100))
  }
  const { result } = await send('Runtime.evaluate', { expression: 'document.querySelector("#result")?.textContent', returnByValue: true }, sessionId)
  await writeFile(resolve(evidence, 'result-text.txt'), result.value ?? 'missing result')
  if (!done) throw new Error('Fixture did not finish within 45s')
  const report = JSON.parse(result.value)
  await writeFile(resolve(evidence, 'result.json'), JSON.stringify(report, null, 2) + '\n')
  for (const [key, filename] of [['movingPanImage', 'moving-pan.png'], ['movingScaleImage', 'moving-scale.png']]) {
    const capture = await send('Runtime.evaluate', { expression: `document.querySelector('#gl').dataset.${key}`, returnByValue: true }, sessionId)
    if (capture.result.value?.startsWith('data:image/png;base64,')) {
      await writeFile(resolve(evidence, filename), Buffer.from(capture.result.value.split(',')[1], 'base64'))
    }
  }
  const screenshot = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
  await writeFile(resolve(evidence, 'topologyLayer.png'), Buffer.from(screenshot.data, 'base64'))
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok || messages.some(message => message.method === 'Runtime.exceptionThrown')) process.exitCode = 1
} finally {
  ws?.close()
  chrome.kill('SIGTERM')
  await closed
  server.close()
  await writeFile(resolve(evidence, 'chrome-stderr.txt'), stderr)
  await writeFile(resolve(evidence, 'chrome-stdout.txt'), stdout)
  await writeFile(resolve(evidence, 'runtime-events.json'), JSON.stringify(messages, null, 2) + '\n')
}
