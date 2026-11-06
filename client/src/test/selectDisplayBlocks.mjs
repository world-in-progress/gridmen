/** Linear-grid benchmark adapter: use the production selector, including clipped tails. */
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../src/core/grid/displayHierarchy.ts', import.meta.url))],
    bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'warning',
})
const { selectDisplayBlocks } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
let input = ''
for await (const chunk of process.stdin) input += chunk
const { layers, origin, viewport, metersPerPixel } = JSON.parse(input)
if (!(metersPerPixel > 0) || !Number.isFinite(metersPerPixel)) throw new Error('Invalid benchmark scale')
const blocks = selectDisplayBlocks(layers, origin, viewport, ([x, y]) => [x / metersPerPixel, y / metersPerPixel])
process.stdout.write(JSON.stringify(blocks))
