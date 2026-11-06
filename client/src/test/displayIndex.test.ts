import assert from 'node:assert/strict'
import test from 'node:test'

import DisplayIndex from '../src/core/grid/displayIndex'
import {
    CELL_PIXEL_THRESHOLD, FULL_OUTLINE_THRESHOLD, intersectionArea, outlineBlend, outlineCoverage, sampleStep,
} from '../src/core/grid/displayMath'
import type { Bounds, DisplayCell, GridDisplayView } from '../src/core/grid/displayTypes'

function cell(id: number, bounds: Bounds, level: number, elevation = 0,
    landClass = 0, deleted = false): DisplayCell {
    return { id, bounds, level, elevation, landClass, deleted }
}

function allFields(view: GridDisplayView) {
    return view.chunks.flatMap(chunk => chunk.fields)
}

function fieldAt(view: GridDisplayView, x: number, y: number) {
    return allFields(view).find(field => field.bounds[0] === x && field.bounds[1] === y)
}

test('mixed coarse cells and fine fields retain original cell geometry and fractional occupancy', () => {
    const index = new DisplayIndex([0, 0, 8, 4], {
        grid_info: [[4, 4], [1, 1], [0.25, 0.25]], alignment_origin: [0, 0],
    })
    index.upsert(cell(1, [0, 0, 4, 4], 0, 100, 8))
    index.upsert(cell(2, [4, 0, 5, 1], 1, 20, 2))
    index.upsert(cell(3, [5, 0, 5.25, 0.25], 2, 40, 3))
    const view = index.query([0, 0, 8, 4], 0.5)
    assert.equal(view.cellCount, 3)
    assert.deepEqual(view.chunks.flatMap(chunk => chunk.cells).map(c => c.id), [1])
    assert.equal(fieldAt(view, 4, 0)?.occupiedFraction, 1)
    assert.equal(fieldAt(view, 4, 0)?.elevation, 20)
    assert.equal(fieldAt(view, 5, 0)?.occupiedFraction, 0.25)
    assert.equal(fieldAt(view, 5, 0)?.minCellSize, 0.25)
    assert.equal(fieldAt(view, 5, 0)?.level, 2)
    assert.equal(fieldAt(view, 5, 0)?.landClass, 3)
    assert.equal(fieldAt(view, 5.5, 0), undefined)
})

test('fields weight occupied area and break land-class ties toward the smaller category', () => {
    const index = new DisplayIndex([0, 0, 1, 1], {
        grid_info: [[1, 1], [0.25, 0.25]], alignment_origin: [0, 0],
    })
    index.upsert(cell(1, [0, 0, 0.25, 0.25], 1, 10, 7))
    index.upsert(cell(2, [0.25, 0, 0.5, 0.25], 1, 20, 3))
    index.upsert(cell(3, [0, 0.25, 0.25, 0.5], 1, 30, 7, true))
    index.upsert(cell(4, [0.25, 0.25, 0.5, 0.5], 1, 40, 3))
    const all = fieldAt(index.query([0, 0, 0.5, 0.5], 0.5), 0, 0)!
    assert.equal(all.occupiedFraction, 1)
    assert.equal(all.elevation, 25)
    assert.equal(all.landClass, 3)
    const live = fieldAt(index.query([0, 0, 0.5, 0.5], 0.5, false), 0, 0)!
    assert.equal(live.occupiedFraction, 0.75)
    assert.ok(Math.abs(live.elevation - 70 / 3) < 1e-10)
    assert.equal(live.landClass, 3)
})

test('arbitrary integer subdivisions retain tiny positive intersections and area weighting', () => {
    const index = new DisplayIndex([0, 0, 3, 2], {
        grid_info: [[3, 2], [1, 1], [1 / 3, 0.5]], alignment_origin: [0, 0],
    })
    index.upsert(cell(1, [0, 0, 1, 1], 1, 10, 5))
    index.upsert(cell(2, [1, 0, 1 + 1 / 3, 0.5], 2, 30, 2))
    const field = fieldAt(index.query([0, 0, 1.5, 1], 0.8), 2 / 3, 0)!
    assert.ok(field)
    assert.ok(Math.abs(field.occupiedFraction - 1) < 1e-12)
    assert.ok(Math.abs(field.elevation - 20) < 1e-12)
    assert.equal(field.landClass, 2)
    assert.equal(field.level, 2)
    assert.ok(Math.abs(field.minCellSize - 1 / 3) < 1e-12)
    // The tiny cell contributes although it does not contain this sample's center.
    assert.equal(index.inspect(0.9, 0.25).cell?.id, 1)
})

test('outline transition is continuous at four and eight pixels and keeps occupancy separate', () => {
    assert.equal(sampleStep(7.8125, 15.625 - 1e-9), 15.625)
    assert.equal(CELL_PIXEL_THRESHOLD, 4)
    assert.equal(FULL_OUTLINE_THRESHOLD, 8)
    const epsilon = 1e-5
    assert.equal(outlineBlend(4), 0)
    assert.equal(outlineBlend(8), 1)
    assert.ok(Math.abs(outlineBlend(4 - epsilon) - outlineBlend(4 + epsilon)) < epsilon)
    assert.ok(Math.abs(outlineBlend(8 - epsilon) - outlineBlend(8 + epsilon)) < epsilon)
    assert.equal(outlineCoverage(0.5, 2), 0.5)
    assert.equal(outlineCoverage(0.5, 0.25), 1)
    const halfOccupiedOpacity = 0.5 * outlineCoverage(0.5, 0.25)
    assert.equal(halfOccupiedOpacity, 0.5)
})

test('selection summaries use the same occupied area without inspecting leaves', () => {
    const index = new DisplayIndex([0, 0, 2, 1], {
        grid_info: [[1, 1], [0.25, 0.25]], alignment_origin: [0, 0],
    })
    index.upsert(cell(1, [0, 0, 1, 1], 0))
    index.upsert(cell(2, [1, 0, 1.25, 0.25], 1))
    const summary = index.summarize([0, 0, 1.5, 0.5])!
    assert.ok(Math.abs(summary.occupiedFraction - 0.5625 / 0.75) < 1e-12)
    assert.equal(summary.minCellSize, 0.25)
    assert.equal(summary.level, 1)
})

test('inspection uses original hanging-edge neighbors and stable segment IDs', () => {
    const index = new DisplayIndex([0, 0, 2, 1], {
        grid_info: [[1, 1], [0.5, 0.5]], alignment_origin: [0, 0],
    })
    index.upsert(cell(10, [0, 0, 1, 1], 0))
    index.upsert(cell(11, [1, 0, 1.5, 0.5], 1))
    index.upsert(cell(12, [1, 0.5, 1.5, 1], 1))
    const inspection = index.inspect(0.5, 0.5)
    assert.equal(inspection.cell?.id, 10)
    assert.deepEqual(inspection.neighbors.map(n => [n.side, n.cell.id]), [['east', 11], ['east', 12]])
    assert.notEqual(inspection.neighbors[0].edgeIds[0], inspection.neighbors[1].edgeIds[0])
    assert.equal(index.inspect(1.25, 0.25).neighbors.find(n => n.cell.id === 10)?.edgeIds[0],
        inspection.neighbors[0].edgeIds[0])
    assert.deepEqual(index.selectBounds([0.9, 0.1, 1.1, 0.9]), [10, 11, 12])
    index.upsert(cell(11, [1, 0, 1.5, 0.5], 1, 0, 0, true))
    assert.deepEqual(index.inspect(0.5, 0.5, false).neighbors.map(n => n.cell.id), [12])
})

test('checkerboard summaries answer a low-zoom query without visiting fine leaves', () => {
    const side = 128
    const index = new DisplayIndex([0, 0, 1, 1], {
        grid_info: [[1, 1], [1 / side, 1 / side]], alignment_origin: [0, 0],
    })
    let id = 1
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
        if ((x + y) % 2 === 0) {
            index.upsert(cell(id++, [x / side, y / side, (x + 1) / side, (y + 1) / side], 1, 10, 2))
        }
    }
    const view = index.query([0, 0, 1, 1], 1)
    assert.equal(fieldAt(view, 0, 0)?.occupiedFraction, 0.5)
    assert.equal(fieldAt(view, 0, 0)?.minCellSize, 1 / side)
    assert.ok(index.queryVisits < 500, `visited ${index.queryVisits} nodes for ${id - 1} leaves`)
    index.remove(1)
    assert.equal(fieldAt(index.query([0, 0, 1, 1], 1), 0, 0)?.occupiedFraction,
        0.5 - 1 / (side * side))
    assert.ok(index.queryVisits < 500)
})

test('area summaries match original cells where field bins cut across nonbinary subdivision edges', () => {
    const index = new DisplayIndex([0, 0, 3, 3], {
        grid_info: [[0.6, 0.6], [0.2, 0.2]], alignment_origin: [0, 0],
    })
    const original: DisplayCell[] = []
    let id = 1
    for (let my = 0; my < 5; my++) for (let mx = 0; mx < 5; mx++) {
        if ((mx + my) % 2 === 0) {
            const x = mx * 0.6
            const y = my * 0.6
            original.push(cell(id, [x, y, x + 0.6, y + 0.6], 0, id % 13, id % 4))
            id++
        } else {
            for (let iy = 0; iy < 3; iy++) for (let ix = 0; ix < 3; ix++) {
                const x = mx * 0.6 + ix * 0.2
                const y = my * 0.6 + iy * 0.2
                original.push(cell(id, [x, y, x + 0.2, y + 0.2], 1, id % 13, id % 4))
                id++
            }
        }
    }
    for (const item of original) index.upsert(item)
    const check = (cells: DisplayCell[]) => {
        const view = index.query([0, 0, 3, 3], 0.7)
        assert.ok(allFields(view).length > 50)
        for (const field of allFields(view)) {
            const area = (field.bounds[2] - field.bounds[0]) * (field.bounds[3] - field.bounds[1])
            let occupied = 0
            let elevationArea = 0
            let minSide = Infinity
            let finest = -Infinity
            const categories = new Map<number, number>()
            for (const item of cells) {
                const overlap = intersectionArea(item.bounds, field.bounds)
                if (overlap <= 0) continue
                occupied += overlap
                elevationArea += overlap * item.elevation
                minSide = Math.min(minSide, item.bounds[2] - item.bounds[0], item.bounds[3] - item.bounds[1])
                finest = Math.max(finest, item.level)
                categories.set(item.landClass, (categories.get(item.landClass) ?? 0) + overlap)
            }
            assert.ok(Math.abs(field.occupiedFraction - occupied / area) < 1e-10)
            assert.ok(Math.abs(field.elevation - elevationArea / occupied) < 1e-10)
            assert.ok(Math.abs(field.minCellSize - minSide) < 1e-10)
            assert.equal(field.level, finest)
            const maximum = Math.max(...categories.values())
            const winning = Math.min(...[...categories].filter(([, value]) =>
                maximum - value < area * 1e-10).map(([category]) => category))
            assert.equal(field.landClass, winning)
        }
    }
    check(original)
    index.remove(original[0].id)
    check(original.slice(1))
})

test('unchanged chunks keep identity and revisions while edits invalidate only intersecting chunks', () => {
    const index = new DisplayIndex([0, 0, 128, 64], {
        grid_info: [[1, 1]], alignment_origin: [0, 0],
    })
    index.upsert(cell(1, [0, 0, 1, 1], 0, 10))
    index.upsert(cell(2, [80, 0, 81, 1], 0, 20))
    const first = index.query([0, 0, 128, 64], 1)
    assert.equal(first.chunks.length, 2)
    const [left, right] = first.chunks
    const leftRevision = index.getChunkRevision(left.key)
    const rightRevision = index.getChunkRevision(right.key)
    const again = index.query([0, 0, 128, 64], 1)
    assert.equal(again.chunks[0], left)
    assert.equal(again.chunks[1], right)
    index.upsert(cell(1, [0, 0, 1, 1], 0, 30))
    const changed = index.query([0, 0, 128, 64], 1)
    assert.notEqual(changed.chunks[0], left)
    assert.equal(changed.chunks[1], right)
    assert.notEqual(index.getChunkRevision(left.key), leftRevision)
    assert.equal(index.getChunkRevision(right.key), rightRevision)
    assert.equal(fieldAt(changed, 0, 0)?.elevation, 30)
})

test('panning retains visible chunk revisions while bounding historical CPU cache', () => {
    const tileWidth = 64 * 4
    const count = 900
    const index = new DisplayIndex([0, 0, count * tileWidth, 4], {
        grid_info: [[4, 4]], alignment_origin: [0, 0],
    })
    for (let i = 0; i < count; i++) {
        index.upsert(cell(i + 1, [i * tileWidth, 0, i * tileWidth + 4, 4], 0))
    }
    const first = index.query([0, 0, tileWidth, 4], 1).chunks[0]
    for (let i = 1; i < count; i++) {
        const view = index.query([i * tileWidth, 0, (i + 1) * tileWidth, 4], 1)
        assert.ok(view.chunks.some(chunk => chunk.cells.some(item => item.id === i + 1)))
    }
    const cache = (index as unknown as { chunks: Map<string, unknown> }).chunks
    assert.ok(cache.size <= 768, `retained ${cache.size} historical chunks`)
    assert.equal(index.getChunkRevision(first.key), 0)
    const latest = index.query([(count - 1) * tileWidth, 0, count * tileWidth, 4], 1).chunks
    assert.ok(latest.every(chunk => index.getChunkRevision(chunk.key) > 0))
})


test('schema is fixed before loading and invalid replacement leaves the original intact', () => {
    assert.throws(() => new DisplayIndex([0, 0, 1, 1], {}), /schema cell sizes/)
    const index = new DisplayIndex([0, 0, 2, 2], { grid_info: [[1, 1]], alignment_origin: [0, 0] })
    index.upsert(cell(1, [0, 0, 1, 1], 0, 10))
    assert.throws(() => index.upsert(cell(1, [0, 0, 0.25, 0.25], 0, 20)))
    assert.equal(index.getCell(1)?.elevation, 10)
    assert.equal(index.summarize([0, 0, 1, 1])?.elevation, 10)
})
