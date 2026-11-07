import assert from 'node:assert/strict'
import test from 'node:test'
import { displayLayers } from '../src/core/grid/displayHierarchy'
import { canonicalDisplayChunks, decodeDisplayBlock } from '../src/core/grid/displayWire'
import type { DisplayBlock, GridDisplayMeta } from '../src/core/grid/displayTypes'

const meta = {
    revision: 'revision-1', displayLayers: displayLayers([0, 0, 2, 2], [[1, 1]], [0, 0]),
    alignment_origin: [0, 0], grid_info: [[1, 1]],
} as GridDisplayMeta
const block: DisplayBlock = { blockLayer: 1, x: 0, y: 0, displayLayer: 0 }

function record(id: bigint, bounds: [number, number, number, number], occupiedArea: number,
    elevationArea: number, minCellSize: number, level: number, landClass: number): ArrayBuffer {
    const buffer = new ArrayBuffer(4 + 72)
    const data = new DataView(buffer)
    data.setUint32(0, 0x47444e35, false)
    data.setBigUint64(4, id, true)
    bounds.forEach((value, i) => data.setFloat64(12 + i * 8, value, true))
    data.setFloat64(44, occupiedArea, true)
    data.setFloat64(52, elevationArea, true)
    data.setFloat64(60, minCellSize, true)
    data.setUint32(68, level, true)
    data.setUint32(72, landClass, true)
    return buffer
}

test('GDN5 decodes original ID, node bounds, occupied area and weighted elevation', () => {
    const original = decodeDisplayBlock(record(42n, [0, 0, 2, 2], 4, 24, 1, 1, 7), block, meta)
    assert.equal(original.key, '1:0:0:0')
    assert.deepEqual(original.bounds, [0, 0, 2, 2])
    assert.deepEqual(original.cells, [{ id: 42, bounds: [0, 0, 2, 2], level: 1, elevation: 6, landClass: 7 }])
    const field = decodeDisplayBlock(record(0n, [0, 0, 1, 1], 0.25, 2, 0.25, 1, 3), block, meta)
    assert.equal(field.fields[0].occupiedFraction, 0.25)
    assert.equal(field.fields[0].elevation, 8)
    assert.equal(field.fields[0].minCellSize, 0.25)
})

test('GDN5 rejects malformed header, length, old magic, unsafe IDs and invalid occupancy', () => {
    const valid = record(1n, [0, 0, 1, 1], 1, 1, 1, 1, 0)
    assert.throws(() => decodeDisplayBlock(valid.slice(0, 3), block, meta), /header/)
    assert.throws(() => decodeDisplayBlock(valid.slice(0, 75), block, meta), /record length/)
    const badMagic = valid.slice(0)
    new DataView(badMagic).setUint32(0, 0x47444e34, false)
    assert.throws(() => decodeDisplayBlock(badMagic, block, meta), /format/)
    const unsafe = valid.slice(0)
    new DataView(unsafe).setBigUint64(4, BigInt(Number.MAX_SAFE_INTEGER) + 1n, true)
    assert.throws(() => decodeDisplayBlock(unsafe, block, meta), /exact integer/)
    const excess = valid.slice(0)
    new DataView(excess).setFloat64(44, 2, true)
    assert.throws(() => decodeDisplayBlock(excess, block, meta), /node/)
})

test('GDN5 decodes a derived ancestor with only the finite storage prefix in metadata', () => {
    const ancestor = { blockLayer: 11, x: 0, y: 0, displayLayer: 11 }
    const chunk = decodeDisplayBlock(record(0n, [0, 0, 2048, 2048], 1, 7, 1, 1, 9), ancestor, meta)
    assert.deepEqual(chunk.bounds, [0, 0, 2048, 2048])
    assert.equal(chunk.fields[0].occupiedFraction, 1 / 2048 ** 2)
    assert.equal(chunk.fields[0].elevation, 7)
    assert.equal(chunk.key, '11:0:0:11')
})

test('one crossing original has the same canonical key and exact bounds in adjacent blocks', () => {
    const first = decodeDisplayBlock(record(42n, [0, 0, 2, 2], 4, 24, 1, 1, 7),
        { blockLayer: 0, x: 0, y: 0, displayLayer: 0 }, meta)
    const second = decodeDisplayBlock(record(42n, [0, 0, 2, 2], 4, 24, 1, 1, 7),
        { blockLayer: 0, x: 1, y: 0, displayLayer: 0 }, meta)
    const a = canonicalDisplayChunks(first), b = canonicalDisplayChunks(second)
    assert.deepEqual(a.map(chunk => chunk.key), ['original:42'])
    assert.deepEqual(b.map(chunk => chunk.key), ['original:42'])
    assert.deepEqual(a[0].bounds, [0, 0, 2, 2])
    assert.deepEqual(b[0].bounds, [0, 0, 2, 2])
})

test('canonical split keeps interior and field samples together and crossing originals at their own bounds', () => {
    const original = { id: 84, bounds: [0.5, 0.25, 1.5, 0.75] as [number, number, number, number], level: 1, elevation: 9, landClass: 3 }
    const interior = { id: 85, bounds: [0.1, 0.1, 0.4, 0.4] as [number, number, number, number], level: 1, elevation: 7, landClass: 2 }
    const field = { bounds: [0, 0, 0.5, 0.5] as [number, number, number, number], level: 1,
        elevation: 5, landClass: 1, occupiedFraction: 0.5, minCellSize: 0.25 }
    const chunks = canonicalDisplayChunks({ key: 'block', bounds: [0, 0, 1, 1], cells: [original, interior], fields: [field] })
    assert.deepEqual(chunks.map(chunk => chunk.key), ['block', 'original:84'])
    assert.deepEqual(chunks[0].cells, [interior])
    assert.deepEqual(chunks[0].fields, [field])
    assert.deepEqual(chunks[1].bounds, original.bounds)
    assert.deepEqual(chunks[1].cells, [original])
})
