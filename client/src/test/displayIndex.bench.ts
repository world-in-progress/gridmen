/**
 * Bundle for Node with esbuild, then run with --expose-gc and enough heap for a
 * million legal native cells. The default 1024 side creates 1,048,576 cells.
 */
import DisplayIndex from '../src/core/grid/displayIndex'
import { selectDisplayBlocks } from '../src/core/grid/displayHierarchy'

const side = Number(process.argv[2] ?? 1024)
if (!Number.isSafeInteger(side) || side <= 0 || (side & (side - 1)) !== 0) {
    throw new Error('Expected a positive power-of-two side')
}
if (!global.gc) throw new Error('Run Node with --expose-gc')

global.gc()
const beforeHeap = process.memoryUsage().heapUsed
const index = new DisplayIndex([0, 0, 1, 1], {
    grid_info: [[1, 1], [1 / side, 1 / side]], alignment_origin: [0, 0],
})
let id = 1
const buildStart = performance.now()
index.load((function* () {
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
        yield {
            id: id++, bounds: [x / side, y / side, (x + 1) / side, (y + 1) / side] as [number, number, number, number],
            level: 1, elevation: 0, landClass: 0,
        }
    }
})())
const buildMs = performance.now() - buildStart
const selectStart = performance.now()
index.selectAll(true)
const selectAllMs = performance.now() - selectStart
if (index.selectedFraction([0, 0, 1, 1]) !== 1) throw new Error('Select all failed')
const clearStart = performance.now()
index.selectAll(false)
const clearAllMs = performance.now() - clearStart
if (index.selectedFraction([0, 0, 1, 1]) !== 0) throw new Error('Clear all failed')
global.gc()
const heapMiB = (process.memoryUsage().heapUsed - beforeHeap) / 1048576
const blocks = selectDisplayBlocks(index.displayLayers, index.origin, index.bounds, ([x, y]) => [x, y])
const queryStart = performance.now()
const view = index.queryBlocks(blocks)
const queryMs = performance.now() - queryStart
const field = view.chunks.flatMap(chunk => chunk.fields).find(item =>
    item.bounds[0] === 0 && item.bounds[1] === 0)
const occupiedArea = field && field.occupiedFraction *
    (field.bounds[2] - field.bounds[0]) * (field.bounds[3] - field.bounds[1])
if (occupiedArea !== 1) throw new Error('Area summary failed')

console.log(JSON.stringify({
    cells: id - 1, buildMs, selectAllMs, clearAllMs, queryMs, heapMiB,
    displayNodes: view.chunks.reduce((sum, chunk) => sum + chunk.cells.length + chunk.fields.length, 0),
}))
