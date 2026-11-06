import assert from 'node:assert/strict'
import test from 'node:test'
import DisplayIndex from '../src/core/grid/displayIndex'
import type { Bounds, DisplayCell, GridDisplayView } from '../src/core/grid/displayTypes'

function cell(id: number, bounds: Bounds, level: number): DisplayCell {
    return { id, bounds, level, elevation: level * 10, landClass: level }
}
function chunkAt(view: GridDisplayView, x: number) {
    const chunk = view.chunks.find(c => c.fields.length && c.bounds[0] === x)
    assert.ok(chunk, `missing field chunk at ${x}`)
    return chunk
}

test('first subdivision and last fine-level merge preserve untouched chunk identities', () => {
    const bounds: Bounds = [0, 0, 192, 4]
    const index = new DisplayIndex(bounds, {
        grid_info: [[4, 4], [1, 1], [0.25, 0.25]], alignment_origin: [0, 0],
    })
    index.upsert(cell(0, [0, 0, 1, 1], 1))
    index.upsert(cell(1, [80, 0, 81, 1], 1))
    index.upsert(cell(2, [160, 0, 161, 1], 1))
    const before = index.query(bounds, 1)
    const beforeKeys = before.chunks.map(c => c.key)
    const revisions = before.chunks.map(c => index.getChunkRevision(c.key))
    const [target, untouched, tail] = [0, 64, 128].map(x => chunkAt(before, x))

    index.remove(0)
    index.remove(2)
    index.upsert(cell(0, [160, 0, 161, 1], 1)) // Tail storage moves into the removed slot.
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        index.upsert(cell(2 + y * 4 + x, [x / 4, y / 4, (x + 1) / 4, (y + 1) / 4], 2))
    }
    const subdivided = index.query(bounds, 1)
    assert.deepEqual(subdivided.chunks.map(c => c.key), beforeKeys)
    assert.equal(chunkAt(subdivided, 64), untouched)
    assert.equal(index.getChunkRevision(untouched.key), revisions[1])
    assert.notEqual(chunkAt(subdivided, 0), target)
    assert.notEqual(chunkAt(subdivided, 128), tail)
    assert.notEqual(index.getChunkRevision(target.key), revisions[0])
    assert.notEqual(index.getChunkRevision(tail.key), revisions[2])
    const stableTail = chunkAt(subdivided, 128)
    const stableTailRevision = index.getChunkRevision(stableTail.key)
    assert.equal(chunkAt(subdivided, 0).fields[0].minCellSize, 0.25)

    for (let id = 2; id < 18; id++) index.remove(id)
    index.upsert(cell(2, [0, 0, 1, 1], 1))
    const merged = index.query(bounds, 1)
    assert.deepEqual(merged.chunks.map(c => c.key), beforeKeys)
    assert.equal(chunkAt(merged, 64), untouched)
    assert.equal(index.getChunkRevision(untouched.key), revisions[1])
    assert.equal(chunkAt(merged, 128), stableTail)
    assert.equal(index.getChunkRevision(stableTail.key), stableTailRevision)
    assert.notEqual(chunkAt(merged, 0), chunkAt(subdivided, 0))
    assert.equal(chunkAt(merged, 0).fields[0].minCellSize, 1)
})

test('a new level invalidates spatially overlapping cached fields built before it existed', () => {
    const bounds: Bounds = [0, 0, 128, 4]
    // The counts-only schema must have the same fixed-mode behavior as grid_info.
    const index = new DisplayIndex(bounds, {
        level_info: [{ width: 32, height: 1 }, { width: 128, height: 4 }, { width: 512, height: 16 }],
        alignment_origin: [0, 0],
    })
    index.upsert(cell(1, [0, 0, 1, 1], 1))
    index.upsert(cell(2, [80, 0, 81, 1], 1))
    const before = index.query(bounds, 1)
    const changed = chunkAt(before, 0), untouched = chunkAt(before, 64)
    const revision = index.getChunkRevision(untouched.key)
    index.upsert(cell(3, [1, 0, 1.25, 0.25], 2))
    const after = index.query(bounds, 1)
    assert.equal(chunkAt(after, 0).key, changed.key)
    assert.notEqual(chunkAt(after, 0), changed)
    assert.equal(chunkAt(after, 64), untouched)
    assert.equal(index.getChunkRevision(untouched.key), revision)
    const added = chunkAt(after, 0).fields.find(f => f.bounds[0] === 1 && f.bounds[1] === 0)
    assert.equal(added?.minCellSize, 0.25)
    assert.equal(added?.occupiedFraction, 0.0625)
})

test('crossing a four-pixel threshold changes field mode even with the same sampling step', () => {
    const bounds: Bounds = [0, 0, 1.2, 0.6]
    const index = new DisplayIndex(bounds, {
        grid_info: [[0.6, 0.6], [0.2, 0.2]], alignment_origin: [0, 0],
    })
    index.upsert(cell(1, [0, 0, 0.6, 0.6], 0))
    index.upsert(cell(2, [0.6, 0, 0.8, 0.2], 1))
    const resolved = index.query(bounds, 0.14)
    const field = index.query(bounds, 0.16)
    const resolvedChunk = chunkAt(resolved, 0), fieldChunk = chunkAt(field, 0)
    assert.deepEqual(fieldChunk.bounds, resolvedChunk.bounds)
    assert.notEqual(fieldChunk.key, resolvedChunk.key)
    assert.equal(resolved.chunks.flatMap(c => c.cells).length, 1)
    assert.equal(field.chunks.flatMap(c => c.cells).length, 0)
    assert.ok(fieldChunk.fields.some(f => f.bounds[0] === 0 && f.minCellSize === 0.6))
    assert.equal(chunkAt(index.query(bounds, 0.14), 0), resolvedChunk)
})
