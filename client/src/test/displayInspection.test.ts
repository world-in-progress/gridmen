import assert from 'node:assert/strict'
import test from 'node:test'
import DisplayIndex from '../src/core/grid/displayIndex'
import { containsPoint } from '../src/core/grid/displayMath'
import type { Bounds, DisplayCell } from '../src/core/grid/displayTypes'

function cell(id: number, bounds: Bounds, level = 0, deleted = false): DisplayCell {
    return { id, bounds, level, elevation: 0, landClass: 0, deleted }
}

test('point containment includes each minimum and excludes each maximum', () => {
    const bounds: Bounds = [0, 0, 1, 1]
    assert.equal(containsPoint(bounds, 0, 0), true)
    assert.equal(containsPoint(bounds, 0, 0.5), true)
    assert.equal(containsPoint(bounds, 0.5, 0), true)
    assert.equal(containsPoint(bounds, 1, 0.5), false)
    assert.equal(containsPoint(bounds, 0.5, 1), false)
    assert.equal(containsPoint(bounds, 1, 1), false)
})

test('inspection assigns shared edges and vertices to their half-open owner', () => {
    const index = new DisplayIndex([0, 0, 2, 2], {
        grid_info: [[1, 1]], alignment_origin: [0, 0],
    })
    index.upsert(cell(0, [0, 0, 1, 1]))
    index.upsert(cell(1, [1, 0, 2, 1]))
    index.upsert(cell(2, [0, 1, 1, 2]))
    index.upsert(cell(3, [1, 1, 2, 2]))

    assert.equal(index.inspect(1, 0.5).cell?.id, 1)
    assert.equal(index.inspect(0.5, 1).cell?.id, 2)
    const vertex = index.inspect(1, 1)
    assert.equal(vertex.cell?.id, 3)
    assert.deepEqual(vertex.neighbors.map(n => [n.side, n.cell.id]), [['west', 2], ['south', 1]])
    assert.equal(index.inspect(0, 0).cell?.id, 0)
    for (const [x, y] of [[2, 0.5], [0.5, 2], [2, 2], [-0.1, 0.5], [0.5, -0.1]]) {
        assert.deepEqual(index.inspect(x, y), { cell: null, neighbors: [] })
    }
})

test('unrelated removal and tail storage migration preserve shared-edge ownership', () => {
    const index = new DisplayIndex([0, 0, 3, 1], {
        grid_info: [[1, 1]], alignment_origin: [0, 0],
    })
    index.upsert(cell(1, [0, 0, 1, 1])) // A
    index.upsert(cell(2, [1, 0, 2, 1])) // B, the last storage slot
    index.upsert(cell(0, [2, 0, 3, 1])) // C, the slot being removed
    const before = index.inspect(1, 0.5).cell

    index.remove(0)
    index.remove(2)
    index.upsert(cell(0, [1, 0, 2, 1])) // B moves to C's slot
    const after = index.inspect(1, 0.5).cell

    assert.deepEqual(before?.bounds, [1, 0, 2, 1])
    assert.deepEqual(after?.bounds, before?.bounds)
    assert.equal(before?.id, 2)
    assert.equal(after?.id, 0)
})

test('hanging-edge vertices and chunk boundaries have one geometric owner', () => {
    const index = new DisplayIndex([0, 0, 65, 1], {
        grid_info: [[1, 1], [0.5, 0.5]], alignment_origin: [0, 0],
    })
    index.upsert(cell(1, [0, 0, 1, 1]))
    index.upsert(cell(2, [1, 0, 1.5, 0.5], 1))
    index.upsert(cell(3, [1, 0.5, 1.5, 1], 1))
    index.upsert(cell(4, [63, 0, 64, 1]))
    index.upsert(cell(5, [64, 0, 65, 1]))

    assert.equal(index.inspect(1, 0.5).cell?.id, 3)
    assert.equal(index.inspect(64, 0.5).cell?.id, 5)
})

test('excluding a deleted owner leaves its boundary empty', () => {
    const index = new DisplayIndex([0, 0, 2, 1], {
        grid_info: [[1, 1]], alignment_origin: [0, 0],
    })
    index.upsert(cell(0, [0, 0, 1, 1]))
    index.upsert(cell(1, [1, 0, 2, 1], 0, true))
    assert.equal(index.inspect(1, 0.5).cell?.id, 1)
    assert.deepEqual(index.inspect(1, 0.5, false), { cell: null, neighbors: [] })
})
