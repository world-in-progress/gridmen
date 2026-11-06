import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const evidence = resolve(root, '../../.verification/topology-browser')
await mkdir(evidence, { recursive: true })
await build({ entryPoints: [resolve(root, 'test/topologyLayer.browser.ts')], bundle: true, platform: 'browser',
    format: 'esm', target: 'chrome120', outfile: resolve(evidence, 'topologyLayer.bundle.js'),
    define: { 'import.meta.env': '{}' }, tsconfig: resolve(root, 'tsconfig.app.json'), logLevel: 'warning' })
const html = '<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#182025;color:#eee;font:14px monospace}#gl{width:512px;height:512px;display:block}#result{white-space:pre-wrap}</style></head><body><div><canvas id="gl" width="512" height="512"></canvas></div><pre id="result">running</pre><script type="module" src="/topologyLayer.bundle.js"></script></body></html>'
const server = createServer(async (req, res) => {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return }
    const routes = new Map([
        ['/topologyLayer.bundle.js', [resolve(evidence, 'topologyLayer.bundle.js'), 'text/javascript']],
        ['/shaders/patch/display.glsl', [resolve(root, 'public/shaders/patch/display.glsl'), 'text/plain']],
    ])
    const route = routes.get(req.url)
    if (!route) { res.writeHead(404); res.end('not found'); return }
    try { res.setHeader('Content-Type', route[1]); res.end(await readFile(route[0])) }
    catch { res.writeHead(500); res.end('fixture unavailable') }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}/`
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const flags = ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-extensions', '--disable-sync', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox', `--user-data-dir=${resolve(evidence, 'chrome-profile')}`, '--virtual-time-budget=10000']
function run(extra) {
    return new Promise((resolveRun, reject) => {
        const child = spawn(chrome, [...flags, ...extra, url], { stdio: ['ignore', 'pipe', 'pipe'] })
        const chunks = [], diagnostics = []
        child.stdout.on('data', c => chunks.push(c))
        child.stderr.on('data', c => diagnostics.push(c))
        const timer = setTimeout(() => child.kill('SIGKILL'), 30000)
        child.on('error', reject)
        child.on('close', code => { clearTimeout(timer); resolveRun({ code, stdout: Buffer.concat(chunks).toString(), stderr: Buffer.concat(diagnostics).toString() }) })
    })
}
try {
    const dom = await run(['--dump-dom'])
    await writeFile(resolve(evidence, 'chrome-dom.txt'), dom.stdout)
    await writeFile(resolve(evidence, 'chrome-stderr.txt'), dom.stderr)
    const match = dom.stdout.match(/<pre id="result">([^<]*)<\/pre>/)
    if (!match) throw new Error(`Chrome did not produce browser result (exit ${dom.code}); see ${evidence}/chrome-stderr.txt`)
    const unescape = value => value.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    const result = JSON.parse(unescape(match[1]))
    await writeFile(resolve(evidence, 'result.json'), JSON.stringify(result, null, 2) + '\n')
    const shot = await run([`--screenshot=${resolve(evidence, 'topologyLayer.png')}`, '--window-size=640,640'])
    if (shot.code !== 0) throw new Error(`Chrome screenshot failed with exit ${shot.code}`)
    console.log(JSON.stringify(result, null, 2))
    if (!result.ok) process.exitCode = 1
} finally { server.close() }
