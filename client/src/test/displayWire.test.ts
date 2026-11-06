import assert from 'node:assert/strict'
import test from 'node:test'
import { displayLayers } from '../src/core/grid/displayHierarchy'
import { decodeDisplayBlock, displayBlockView } from '../src/core/grid/displayWire'
import type { DisplayBlock, GridDisplayMeta } from '../src/core/grid/displayTypes'

const meta = {
    revision: 'revision-1', displayLayers: displayLayers([0, 0, 2, 2], [[1, 1]], [0, 0]),
    alignment_origin: [0, 0], grid_info: [[1, 1]], cellCount: 2,
} as GridDisplayMeta
const block: DisplayBlock = { blockLayer: 1, x: 0, y: 0, displayLayer: 0 }

function record(id: bigint, bounds: [number, number, number, number], occupiedArea: number,
    elevationArea: number, minCellSize: number, level: number, landClass: number): ArrayBuffer {
    const buffer = new ArrayBuffer(8 + 72)
    const data = new DataView(buffer)
    data.setUint32(0, 0x47444e34, false)
    data.setUint32(4, 1, true)
    data.setBigUint64(8, id, true)
    bounds.forEach((value, i) => data.setFloat64(16 + i * 8, value, true))
    data.setFloat64(48, occupiedArea, true)
    data.setFloat64(56, elevationArea, true)
    data.setFloat64(64, minCellSize, true)
    data.setUint32(72, level, true)
    data.setUint32(76, landClass, true)
    return buffer
}

test('GDN4 decodes original ID, node bounds, occupied area and weighted elevation', () => {
    const original = decodeDisplayBlock(record(42n, [0, 0, 2, 2], 4, 24, 1, 1, 7), block, meta)
    assert.equal(original.key, '1:0:0:0')
    assert.deepEqual(original.bounds, [0, 0, 2, 2])
    assert.deepEqual(original.cells, [{ id: 42, bounds: [0, 0, 2, 2], level: 1, elevation: 6, landClass: 7 }])
    const field = decodeDisplayBlock(record(0n, [0, 0, 1, 1], 0.25, 2, 0.25, 1, 3), block, meta)
    assert.equal(field.fields[0].occupiedFraction, 0.25)
    assert.equal(field.fields[0].elevation, 8)
    assert.equal(field.fields[0].minCellSize, 0.25)
})

test('GDN4 rejects malformed header, length, unsafe IDs and invalid occupancy', () => {
    const valid = record(1n, [0, 0, 1, 1], 1, 1, 1, 1, 0)
    assert.throws(() => decodeDisplayBlock(valid.slice(0, 7), block, meta), /header/)
    assert.throws(() => decodeDisplayBlock(valid.slice(0, 79), block, meta), /record count/)
    const badMagic = valid.slice(0)
    new DataView(badMagic).setUint32(0, 0, false)
    assert.throws(() => decodeDisplayBlock(badMagic, block, meta), /format/)
    const unsafe = valid.slice(0)
    new DataView(unsafe).setBigUint64(8, BigInt(Number.MAX_SAFE_INTEGER) + 1n, true)
    assert.throws(() => decodeDisplayBlock(unsafe, block, meta), /exact integer/)
    const excess = valid.slice(0)
    new DataView(excess).setFloat64(48, 2, true)
    assert.throws(() => decodeDisplayBlock(excess, block, meta), /node/)
})

test('GDN4 decodes a derived ancestor with only the finite storage prefix in metadata', () => {
    const ancestor = { blockLayer: 11, x: 0, y: 0, displayLayer: 11 }
    const chunk = decodeDisplayBlock(record(0n, [0, 0, 2048, 2048], 1, 7, 1, 1, 9), ancestor, meta)
    assert.deepEqual(chunk.bounds, [0, 0, 2048, 2048])
    assert.equal(chunk.fields[0].occupiedFraction, 1 / 2048 ** 2)
    assert.equal(chunk.fields[0].elevation, 7)
    assert.equal(chunk.key, '11:0:0:11')
})

test('one original spanning several blocks appears once in the merged view', () => {
    const first = decodeDisplayBlock(record(42n, [0, 0, 2, 2], 4, 24, 1, 1, 7),
        { blockLayer: 0, x: 0, y: 0, displayLayer: 0 }, meta)
    const second = decodeDisplayBlock(record(42n, [0, 0, 2, 2], 4, 24, 1, 1, 7),
        { blockLayer: 0, x: 1, y: 0, displayLayer: 0 }, meta)
    const view = displayBlockView([first, second], 2)
    assert.equal(view.chunks.length, 1)
    assert.equal(view.chunks[0].key, 'original:42')
    assert.equal(view.chunks[0].cells.length, 1)
})

test('an original crossing only one side of a block keeps its real bounds and one stable owner', () => {
    const original = { id: 84, bounds: [0.5, 0.25, 1.5, 0.75] as [number, number, number, number], level: 1, elevation: 9, landClass: 3 }
    const a = { key: 'left', bounds: [0, 0, 1, 1] as [number, number, number, number], cells: [original], fields: [] }
    const b = { key: 'right', bounds: [1, 0, 2, 1] as [number, number, number, number], cells: [original], fields: [] }
    const before = displayBlockView([a], 1)
    const after = displayBlockView([a, b], 1, before)
    assert.equal(after.chunks.length, 1)
    assert.equal(after.chunks[0], before.chunks[0])
    assert.equal(after.chunks[0].cells[0], original)
    assert.deepEqual(after.chunks[0].bounds, original.bounds)
})
