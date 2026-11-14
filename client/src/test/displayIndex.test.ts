import assert from 'node:assert/strict'
import test from 'node:test'
import DisplayIndex from '../src/core/grid/displayIndex'
import { outlineBlend, outlineCoverage } from '../src/core/grid/displayMath'
import { blockKey, displayLayer, displayLayers, nodeBounds, nodeRange, projectedRadius, selectDisplayBlocks } from '../src/core/grid/displayHierarchy'
import type { Bounds, DisplayBlock, DisplayCell, GridDisplayView } from '../src/core/grid/displayTypes'

function cell(id: number, bounds: Bounds, level: number, elevation = 0,
    landClass = 0, deleted = false): DisplayCell {
    return { id, bounds, level, elevation, landClass, deleted }
}
const fields = (view: GridDisplayView) => view.chunks.flatMap(chunk => chunk.fields)
const cells = (view: GridDisplayView) => view.chunks.flatMap(chunk => chunk.cells)
const fieldAt = (view: GridDisplayView, x: number, y: number) =>
    fields(view).find(field => field.bounds[0] === x && field.bounds[1] === y)

test('storage roots continue to grid ancestors until the circle contains a raster center', () => {
    const viewport: Bounds = [0, 0, 16, 16]
    const layers = displayLayers(viewport, [[16, 16], [1, 1]], [0, 0])
    assert.equal(layers.length, 6)
    const project = ([x, y]: [number, number]): [number, number] => [0.6 + x / 1000, 0.6 + y / 1000]
    const blocks = selectDisplayBlocks(layers, [0, 0], viewport, project)
    assert.deepEqual(blocks, [{ blockLayer: 11, x: 0, y: 0, displayLayer: 11 }])
    const bounds = nodeBounds(displayLayer(layers, 11), 0, 0, [0, 0])
    assert.deepEqual(bounds, [0, 0, 2048, 2048])
    assert.ok(projectedRadius(bounds, project) >= 0.75)
    const [left, bottom] = project([bounds[0], bounds[1]])
    const [right, top] = project([bounds[2], bounds[3]])
    assert.ok(Math.ceil(left - 0.5) + 0.5 < right)
    assert.ok(Math.ceil(bottom - 0.5) + 0.5 < top)
    assert.equal(layers.length, 6, 'the advertised storage prefix is immutable')
})

test('repeated zoom across storage roots preserves negative, origin-crossing and clipped lattices', () => {
    for (const viewport of [[-30, -42, -15, -21], [-15, -21, 30, 42]] as Bounds[]) {
        const layers = displayLayers(viewport, [[15, 21], [1, 3]], [0, 0])
        const seen = new Map<number, string[]>()
        for (const mpp of [1, 1000, 1e6, 2 ** 80, 1e6, 1000, 1]) {
            const project = ([x, y]: [number, number]): [number, number] => [0.6 + x / mpp, 0.73 + y / mpp]
            const blocks = selectDisplayBlocks(layers, [0, 0], viewport, project)
            assert.ok(blocks.length > 0 && blocks.length <= 4)
            const keys = blocks.map(blockKey)
            if (seen.has(mpp)) assert.deepEqual(keys, seen.get(mpp))
            seen.set(mpp, keys)
            for (const block of blocks) {
                const selected = displayLayer(layers, block.displayLayer)
                const bounds = nodeBounds(displayLayer(layers, block.blockLayer), block.x, block.y, [0, 0])
                const [x0, y0, x1, y1] = nodeRange(selected, bounds, [0, 0])
                for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
                    const b = nodeBounds(selected, x, y, [0, 0])
                    assert.ok(projectedRadius(b, project) >= 0.75 - 1e-9)
                    const [left, bottom] = project([b[0], b[1]]), [right, top] = project([b[2], b[3]])
                    assert.ok(Math.ceil(left - 0.5) + 0.5 < right && Math.ceil(bottom - 0.5) + 0.5 < top)
                }
            }
        }
    }
})

test('the same ancestor tuple reuses a chunk across cameras and can query finer stored nodes', () => {
    const index = new DisplayIndex([0, 0, 16, 16], { grid_info: [[16, 16], [1, 1]], alignment_origin: [0, 0] })
    index.load([cell(1, [0, 0, 1, 1], 1, 7, 9)])
    const choose = (mpp: number) => selectDisplayBlocks(index.displayLayers, index.origin, index.bounds, ([x, y]) => [0.6 + x / mpp, 0.6 + y / mpp])
    const first = choose(1000), next = choose(1200)
    assert.deepEqual(first, next)
    const chunk = index.queryBlocks(first).chunks[0]
    assert.equal(index.queryBlocks(next).chunks[0], chunk)
    assert.equal(chunk.fields[0].occupiedFraction, 1 / 2048 ** 2)
    assert.deepEqual(cells(index.queryBlocks([{ ...first[0], displayLayer: 0 }])).map(c => c.id), [1])
    assert.equal(index.summarize(chunk.fields[0].bounds)?.minCellSize, 1)
})

test('the circle rule keeps a wide parent when 128-pixel subdivision would miss a nonempty node', () => {
    const index = new DisplayIndex([0, 0, 1000, 1], { grid_info: [[1000, 1], [1, 0.001]], alignment_origin: [0, 0] })
    index.load([cell(1, [0, 0, 1, 0.001], 1)])
    const project = ([x, y]: [number, number]): [number, number] => [x + 0.1, y + 0.1]
    const blocks = selectDisplayBlocks(index.displayLayers, index.origin, index.bounds, project)
    const samples = fields(index.queryBlocks(blocks))
    assert.equal(samples.length, 1)
    assert.deepEqual(samples[0].bounds, [0, 0, 2000, 2])
    for (const sample of samples) {
        assert.ok(projectedRadius(sample.bounds, project) >= 0.75)
        const [left, bottom] = project([sample.bounds[0], sample.bounds[1]])
        const [right, top] = project([sample.bounds[2], sample.bounds[3]])
        assert.ok(Math.ceil(left - 0.5) + 0.5 < right && Math.ceil(bottom - 0.5) + 0.5 < top)
    }
})

test('clipped nonbinary tails and every selected node satisfy the circle rule', () => {
    const layers = displayLayers([0, 0, 3, 3], [[3, 3], [1, 1]], [0, 0])
    const intermediate = layers.find(layer => layer.width === 2)!
    assert.deepEqual(nodeBounds(intermediate, 1, 1, [0, 0]), [2, 2, 3, 3])
    assert.deepEqual(nodeRange(intermediate, [0, 0, 3, 3], [0, 0]), [0, 0, 2, 2])
    const project = ([x, y]: [number, number]): [number, number] => [x * 1.4 + 0.13, y * 1.4 + 0.37]
    assert.ok(projectedRadius(nodeBounds(intermediate, 1, 1, [0, 0]), project) < 0.75)
    const blocks = selectDisplayBlocks(layers, [0, 0], [0, 0, 3, 3], project)
    assert.ok(blocks.length > 0)
    for (const block of blocks) {
        const bounds = nodeBounds(layers[block.blockLayer], block.x, block.y, [0, 0])
        const [x0, y0, x1, y1] = nodeRange(layers[block.displayLayer], bounds, [0, 0])
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
            assert.ok(projectedRadius(nodeBounds(layers[block.displayLayer], x, y, [0, 0]), project) >= 0.75 - 1e-9,
                `undersized node ${blockKey(block)}:${x},${y}`)
        }
    }
})

test('arbitrary subpixel phase gives each selected node an ordinary pixel center', () => {
    const layers = displayLayers([0, 0, 8, 8], [[1, 1]], [0, 0])
    for (const phase of [0, 0.07, 0.31, 0.499, 0.73, 0.99]) {
        const scale = 1.5
        const project = ([x, y]: [number, number]): [number, number] => [x * scale + phase, y * scale + 0.37]
        for (const block of selectDisplayBlocks(layers, [0, 0], [0, 0, 8, 8], project)) {
            const [x0, y0, x1, y1] = nodeRange(layers[block.displayLayer],
                nodeBounds(layers[block.blockLayer], block.x, block.y, [0, 0]), [0, 0])
            for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
                const [left, bottom, right, top] = nodeBounds(layers[block.displayLayer], x, y, [0, 0])
                const centerX = Math.ceil(left * scale + phase - 0.5) + 0.5
                const centerY = Math.ceil(bottom * scale + 0.37 - 0.5) + 0.5
                assert.ok(centerX < right * scale + phase && centerY < top * scale + 0.37,
                    `missed ${blockKey(block)} at phase ${phase}`)
            }
        }
    }
})

test('mixed coarse and fine regions retain originals, holes and fractional occupancy', () => {
    const index = new DisplayIndex([0, 0, 8, 4], { grid_info: [[4, 4], [1, 1], [0.25, 0.25]], alignment_origin: [0, 0] })
    index.load([
        cell(1, [0, 0, 4, 4], 0, 100, 8), cell(2, [4, 0, 5, 1], 1, 20, 2),
        cell(3, [5, 0, 5.25, 0.25], 2, 40, 3), cell(4, [5.25, 0, 5.5, 0.25], 2, 60, 4, true),
    ])
    const view = index.queryBlocks(selectDisplayBlocks(index.displayLayers, index.origin, index.bounds, ([x, y]) => [x / 0.5, y / 0.5]))
    assert.deepEqual(cells(view).map(item => item.id), [1, 2])
    assert.equal(fieldAt(view, 5, 0)?.occupiedFraction, 0.125)
    assert.equal(fieldAt(view, 5, 0)?.elevation, 0)
    assert.equal(fieldAt(view, 5, 0)?.minCellSize, 0.25)
    assert.equal(fieldAt(index.queryBlocks(selectDisplayBlocks(index.displayLayers, index.origin, index.bounds, ([x, y]) => [x / 0.5, y / 0.5]), false), 5, 0)?.occupiedFraction, 0.0625)
    assert.equal(fieldAt(view, 5.5, 0), undefined)
})

test('tiny live and deleted cells survive updates beside a large area', () => {
    const coarse = cell(1, [0, 0, 100000000, 100000000], 0, 1)
    const fine = cell(2, [100000000, 0, 100000001, 1], 1, 2)
    const make = () => new DisplayIndex([0, 0, 200000000, 100000000], {
        grid_info: [[100000000, 100000000], [1, 1]], alignment_origin: [0, 0],
    })
    const root: Bounds = [0, 0, 200000000, 200000000]
    const index = make()
    index.upsert(coarse)
    index.upsert({ ...fine, deleted: true })
    assert.equal(index.summarize(root, false)?.minCellSize, 100000000)
    index.upsert(fine)
    index.remove(coarse.id)
    assert.equal(index.summarize(root)?.minCellSize, 1)
    assert.ok(index.summarize(root)!.occupiedFraction > 0)
    const rebuilt = make()
    rebuilt.load([fine])
    assert.deepEqual(index.summarize(root), rebuilt.summarize(root))
})

test('selection summary requires one complete display node', () => {
    const index = new DisplayIndex([0, 0, 2, 1], { grid_info: [[1, 1], [0.25, 0.25]], alignment_origin: [0, 0] })
    index.load([cell(1, [0, 0, 1, 1], 0), cell(2, [1, 0, 1.25, 0.25], 1)])
    assert.equal(index.summarize([1, 0, 2, 1])?.occupiedFraction, 0.0625)
    assert.throws(() => index.summarize([0, 0, 1.5, 0.5]), /display node/)
})

test('selection shares all and live ancestor summaries through edits', () => {
    const index = new DisplayIndex([0, 0, 2, 2], {
        grid_info: [[1, 1], [0.5, 0.5]], alignment_origin: [0, 0],
    })
    const root: Bounds = [0, 0, 2, 2]
    index.load([cell(1, [0, 0, 1, 1], 0), cell(2, [1, 0, 1.5, 0.5], 1, 0, 0, true)])
    index.setSelected(2, true)
    assert.equal(index.selectedFraction(root), 0.2)
    assert.equal(index.selectedFraction(root, false), 0)
    index.selectAll(true)
    assert.equal(index.selectedFraction(root), 1)
    assert.equal(index.selectedFraction(root, false), 1)
    index.upsert(cell(2, [1, 0, 1.5, 0.5], 1))
    assert.equal(index.selectedFraction(root, false), 1)
    index.setSelected(1, false)
    assert.equal(index.selectedFraction(root), 0.2)
    index.remove(2)
    assert.equal(index.selectedFraction(root), 0)
    index.upsert(cell(2, [1, 0, 1.5, 0.5], 1))
    assert.equal(index.selectedFraction(root), 0)
    index.selectAll(false)
    assert.equal(index.selectedFraction(root), 0)
})

test('uniform selection follows bulk epochs and exceptions without selecting empty nodes', () => {
    const index = new DisplayIndex([0, 0, 4, 2], {
        grid_info: [[2, 2], [0.5, 0.5]], alignment_origin: [0, 0],
    })
    const coarse = cell(1, [0, 0, 2, 2], 0)
    const fine = cell(2, [2, 0, 2.5, 0.5], 1, 0, 0, true)
    const root: Bounds = [0, 0, 4, 4]
    const hole: Bounds = [3, 0, 4, 1]
    assert.equal(index.uniformSelection, false)
    index.selectAll(true)
    assert.equal(index.uniformSelection, true)
    assert.equal(index.selectedFraction(root), 0, 'an empty index still has no selected area')
    index.load([coarse, fine])
    for (const selected of [false, true, false, true]) {
        index.selectAll(selected)
        assert.equal(index.uniformSelection, selected)
        assert.equal(index.selectedFraction(root), Number(selected))
        assert.equal(index.selectedFraction(root, false), Number(selected))
        assert.equal(index.selectedFraction(hole), 0)
        assert.equal(index.selectedFraction(fine.bounds, false), 0, 'a deleted-only node is empty in the live view')
        assert.equal(index.selectedFraction([0, 0, 0.5, 0.5]), Number(selected), 'subnodes of a spanning original retain its selection')
    }
    index.setSelected(coarse.id, false)
    assert.equal(index.uniformSelection, undefined)
    assert.equal(index.selectedFraction(root), 1 / 17)
    assert.equal(index.selectedFraction(root, false), 0)
    index.upsert({ ...fine, deleted: false })
    assert.equal(index.selectedFraction(root, false), 1 / 17)
    index.setSelected(coarse.id, true)
    assert.equal(index.uniformSelection, true, 'removing the last exception restores the bulk default')
    index.remove(fine.id)
    index.upsert({ ...fine, deleted: false })
    assert.equal(index.uniformSelection, undefined, 'a new cell is initially unselected after bulk selection')
    assert.equal(index.selectedFraction(root), 16 / 17)
    index.remove(fine.id)
    assert.equal(index.uniformSelection, true, 'removing an exceptional cell restores uniform selection')
    index.selectAll(false)
    assert.equal(index.uniformSelection, false)
    assert.equal(index.selectedFraction(root), 0)
    index.setSelected(coarse.id, true)
    assert.equal(index.uniformSelection, true, 'all cells can also be selected individually')
    index.selectAll(true)
    index.setSelected(coarse.id, false)
    assert.equal(index.uniformSelection, false, 'all cells can also be deselected individually')
    assert.equal(index.selectedFraction(root), 0)
    assert.throws(() => index.selectedFraction([0, 0, 1.5, 0.5]), /display node/)
})

test('removing the only finest cell restores the coarser minimum real cell side', () => {
    const index = new DisplayIndex([0, 0, 2, 2], { grid_info: [[1, 1], [0.25, 0.25]], alignment_origin: [0, 0] })
    index.load([cell(1, [0, 0, 1, 1], 0), cell(2, [1, 0, 1.25, 0.25], 1)])
    assert.equal(index.summarize([0, 0, 2, 2])?.minCellSize, 0.25)
    index.remove(2)
    assert.equal(index.summarize([0, 0, 2, 2])?.minCellSize, 1)
})

test('centered line density and fixed four CSS pixel transition agree at DPR 1 and 2', () => {
    assert.equal(outlineCoverage(0.5, 2), 0.4375)
    assert.equal(outlineCoverage(0.5, 0.25), 1)
    assert.equal(outlineBlend(4), 0)
    assert.equal(outlineBlend(8), 1)
    for (const dpr of [1, 2]) assert.equal(outlineCoverage(dpr, 4 * dpr), 0.4375)
})

test('patch inspection preserves hanging-edge neighbors without synthetic edge identifiers', () => {
    const index = new DisplayIndex([0, 0, 2, 1], { grid_info: [[1, 1], [0.5, 0.5]], alignment_origin: [0, 0] })
    index.load([cell(10, [0, 0, 1, 1], 0), cell(11, [1, 0, 1.5, 0.5], 1), cell(12, [1, 0.5, 1.5, 1], 1)])
    const inspection = index.inspect(0.5, 0.5)
    assert.equal(inspection.cell?.id, 10)
    assert.deepEqual(inspection.neighbors.map(n => [n.side, n.cell.id]), [['east', 11], ['east', 12]])
    for (const neighbor of inspection.neighbors) {
        assert.equal('edgeIds' in neighbor, false)
        assert.equal('edgeKeys' in neighbor, false)
    }
    const reverse = index.inspect(1.25, 0.25).neighbors.find(n => n.cell.id === 10)
    assert.ok(reverse)
    assert.equal(reverse.side, 'west')
    assert.equal('edgeIds' in reverse, false)
    assert.equal('edgeKeys' in reverse, false)
    assert.deepEqual(index.selectBounds([0.9, 0.1, 1.1, 0.9]), [10, 11, 12])
    index.upsert(cell(11, [1, 0, 1.5, 0.5], 1, 0, 0, true))
    assert.deepEqual(index.inspect(0.5, 0.5, false).neighbors.map(n => n.cell.id), [12])
})

test('one edit leaves distant block identity unchanged', () => {
    const index = new DisplayIndex([0, 0, 128, 2], { grid_info: [[1, 1]], alignment_origin: [0, 0] })
    index.load([cell(1, [0, 0, 1, 1], 0, 10), cell(2, [80, 0, 81, 1], 0, 20)])
    const blockLayer = index.displayLayers.findIndex(layer => layer.width === 64)
    const blocks: DisplayBlock[] = [
        { blockLayer, x: 0, y: 0, displayLayer: 0 },
        { blockLayer, x: 1, y: 0, displayLayer: 0 },
    ]
    const first = index.queryBlocks(blocks).chunks
    assert.equal(first.length, 2)
    const distant = first[1]
    index.upsert(cell(1, [0, 0, 1, 1], 0, 30))
    const next = index.queryBlocks(blocks).chunks
    assert.notEqual(next[0], first[0])
    assert.equal(next[1], distant)
    index.remove(1)
    assert.deepEqual(index.selectBounds([0, 0, 2, 2]), [])
})

test('edits refresh virtual ancestors and fine nodes while distant chunks keep their identity', () => {
    const make = () => new DisplayIndex([-256, 0, 256, 32], {
        grid_info: [[16, 16], [1, 1]], alignment_origin: [0, 0],
    })
    const index = make()
    const near = cell(1, [0, 0, 1, 1], 1, 7, 9)
    const neighbor = cell(2, [1, 0, 2, 1], 1, 3, 2, true)
    const far = cell(3, [-256, 0, -240, 16], 0, 10, 3)
    index.load([near, neighbor, far])
    const ancestor = index.displayLayers.length + 8
    const coarse: DisplayBlock[] = [-1, 0].map(x => ({ blockLayer: ancestor, x, y: 0, displayLayer: ancestor }))
    const fine: DisplayBlock[] = [-8, 0].map(x => ({ blockLayer: 5, x, y: 0, displayLayer: 0 }))
    // Extending or editing the summary tree must never iterate source cells.
    const source = (index as unknown as { cells: Map<number, DisplayCell> }).cells
    source.values = () => { throw new Error('Unexpected original-cell scan') }
    source[Symbol.iterator] = () => { throw new Error('Unexpected original-cell scan') }
    const originalCoarse = index.queryBlocks(coarse).chunks
    index.cache.retain(index.cacheKeys(coarse), true)
    const originalFine = index.queryBlocks(fine).chunks
    index.cache.retain(index.cacheKeys(fine), true)
    const farCoarse = originalCoarse[0], farFine = originalFine[0]
    for (const replacement of [{ ...near, elevation: 19, landClass: 4 }, { ...near, deleted: true }, near]) {
        index.upsert(replacement)
        const expected = make()
        expected.load([replacement, neighbor, far])
        for (const showDeleted of [true, false]) {
            assert.deepEqual(fields(index.queryBlocks(coarse, showDeleted)), fields(expected.queryBlocks(coarse, showDeleted)))
            assert.deepEqual(cells(index.queryBlocks(fine, showDeleted)).sort((a, b) => a.id - b.id),
                cells(expected.queryBlocks(fine, showDeleted)).sort((a, b) => a.id - b.id))
            const b = nodeBounds(displayLayer(index.displayLayers, ancestor), 0, 0, index.origin)
            assert.deepEqual(index.summarize(b, showDeleted), expected.summarize(b, showDeleted))
        }
        assert.equal(index.queryBlocks(coarse).chunks[0], farCoarse)
        assert.equal(index.queryBlocks(fine).chunks[0], farFine)
    }
    index.remove(near.id)
    assert.equal(fields(index.queryBlocks(coarse))[1].minCellSize, 1)
    assert.equal(index.queryBlocks(coarse, false).chunks.length, 1)
    index.upsert(near)
    assert.equal(fields(index.queryBlocks(coarse))[1].landClass, 0)
})

test('fixed viewport output stays bounded when leaf count quadruples', () => {
    const measurements: { leaves: number; output: number }[] = []
    for (const side of [64, 128]) {
        const index = new DisplayIndex([0, 0, 1, 1], { grid_info: [[1, 1], [1 / side, 1 / side]], alignment_origin: [0, 0] })
        const original: DisplayCell[] = []
        let id = 1
        for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
            if ((x + y) % 2 === 0) original.push(cell(id++, [x / side, y / side, (x + 1) / side, (y + 1) / side], 1, 10, 2))
        }
        index.load(original)
        const view = index.queryBlocks(selectDisplayBlocks(index.displayLayers, index.origin, index.bounds, ([x, y]) => [x / 1000, y / 1000]))
        const sample = fieldAt(view, 0, 0)!
        const area = (sample.bounds[2] - sample.bounds[0]) * (sample.bounds[3] - sample.bounds[1])
        assert.equal(sample.occupiedFraction * area, 0.5)
        measurements.push({ leaves: original.length, output: fields(view).length + cells(view).length })
    }
    assert.equal(measurements[1].leaves, measurements[0].leaves * 4)
    assert.equal(measurements[1].output, measurements[0].output)
})
