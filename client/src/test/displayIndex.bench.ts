/**
 * Run after bundling for Node with esbuild and with --expose-gc.
 * Example (from the repository root): node --expose-gc .verification/displayIndex.bench.mjs 128
 * A 128-wide checkerboard inserts 8,192 cells; 256 inserts 32,768.
 */
import DisplayIndex from '../src/core/grid/displayIndex'

const side = Number(process.argv[2] ?? 128)
if (!Number.isSafeInteger(side) || side <= 0 || (side & (side - 1)) !== 0) {
    throw new Error('Expected a positive power-of-two checkerboard side')
}
if (!global.gc) throw new Error('Run Node with --expose-gc')

global.gc()
const beforeHeap = process.memoryUsage().heapUsed
const index = new DisplayIndex([0, 0, 1, 1], {
    grid_info: [[1, 1], [1 / side, 1 / side]],
    alignment_origin: [0, 0],
})
let id = 1
const buildStart = performance.now()
index.load((function* () {
    for (let y = 0; y < side; y++) {
        for (let x = 0; x < side; x++) {
            if ((x + y) % 2 === 0) {
                yield {
                    id: id++, bounds: [x / side, y / side, (x + 1) / side, (y + 1) / side] as [number, number, number, number],
                    level: 1, elevation: 10, landClass: 2,
                }
            }
        }
    }
})())
const buildMs = performance.now() - buildStart
global.gc()
const heapMiB = (process.memoryUsage().heapUsed - beforeHeap) / 1048576
const queryStart = performance.now()
const view = index.query([0, 0, 1, 1], 1)
const queryMs = performance.now() - queryStart
const field = view.chunks.flatMap(chunk => chunk.fields).find(item =>
    item.bounds[0] === 0 && item.bounds[1] === 0)
const occupiedArea = field && field.occupiedFraction *
    (field.bounds[2] - field.bounds[0]) * (field.bounds[3] - field.bounds[1])
if (occupiedArea !== 0.5) throw new Error('Checkerboard area summary failed')

console.log(JSON.stringify({
    cells: id - 1, buildMs, queryMs, heapMiB, queryVisits: index.queryVisits,
    displayNodes: view.chunks.reduce((sum, chunk) => sum + chunk.cells.length + chunk.fields.length, 0),
}))
