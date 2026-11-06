import assert from 'node:assert/strict'
import test from 'node:test'

import type { DisplayChunk } from '../src/core/grid/displayTypes'
import { ChunkBuffers } from '../src/views/mapView/topology/chunkBuffers'

function chunk(key: string, cells = 1, fields = 0): DisplayChunk {
    return {
        key, bounds: [0, 0, 1, 1],
        cells: Array.from({ length: cells }, (_, id) => ({
            id, bounds: [0, 0, 1, 1] as [number, number, number, number],
            level: 0, elevation: 0, landClass: 0,
        })),
        fields: Array.from({ length: fields }, () => ({
            bounds: [0, 0, 1, 1] as [number, number, number, number],
            minCellSize: 1, level: 0, elevation: 0, landClass: 0, occupiedFraction: 1,
        })),
    }
}

function mockGl() {
    let nextId = 0
    let failUpload = false
    let glError = 0
    const uploads: number[] = []
    const deletedBuffers: object[] = []
    const deletedVaos: object[] = []
    const attributes: { location: number; width: number; stride: number; offset: number }[] = []
    const divisors: { location: number; divisor: number }[] = []
    const gl = {
        ARRAY_BUFFER: 34962, STATIC_DRAW: 35044, FLOAT: 5126, NO_ERROR: 0,
        createBuffer: () => ({ id: ++nextId }),
        createVertexArray: () => ({ id: ++nextId }),
        deleteBuffer: (buffer: object) => deletedBuffers.push(buffer),
        deleteVertexArray: (vao: object) => deletedVaos.push(vao),
        bindBuffer: () => {}, bindVertexArray: () => {},
        bufferData: (_target: number, data: Float32Array) => {
            if (failUpload) throw new Error('upload failed')
            uploads.push(data.byteLength)
        },
        getError: () => { const error = glError; glError = 0; return error },
        enableVertexAttribArray: () => {},
        vertexAttribPointer: (location: number, width: number, _type: number,
            _normalized: boolean, stride: number, offset: number) => {
            attributes.push({ location, width, stride, offset })
        },
        vertexAttribDivisor: (location: number, divisor: number) => {
            divisors.push({ location, divisor })
        },
    }
    return {
        gl: gl as unknown as WebGL2RenderingContext,
        uploads, deletedBuffers, deletedVaos, attributes, divisors,
        setFailUpload(value: boolean) { failUpload = value },
        setGlError(value: number) { glError = value },
    }
}

const prepare = (item: DisplayChunk) => ({
    data: new Float32Array((item.cells.length + item.fields.length) * 16),
    origin: [item.bounds[0], item.bounds[1]] as [number, number],
})

test('uploads exact instance bytes and preserves unchanged chunk resources', () => {
    const mock = mockGl()
    const buffers = new ChunkBuffers(mock.gl)
    const a = chunk('a', 2, 1)
    let preparations = 0
    const trackedPrepare = (item: DisplayChunk) => {
        preparations++
        return prepare(item)
    }
    buffers.sync([a], () => 1, trackedPrepare)
    const resource = buffers.chunks.get('a')!
    assert.equal(buffers.gpuBytes, 192)
    assert.deepEqual(mock.uploads, [192])
    assert.equal(resource.count, 3)
    assert.equal(resource.visibleCells, 2)
    assert.equal(resource.fieldSamples, 1)
    assert.deepEqual(mock.attributes, [
        { location: 0, width: 2, stride: 64, offset: 0 },
        { location: 1, width: 2, stride: 64, offset: 8 },
        { location: 2, width: 2, stride: 64, offset: 16 },
        { location: 3, width: 2, stride: 64, offset: 24 },
        { location: 4, width: 4, stride: 64, offset: 32 },
        { location: 5, width: 4, stride: 64, offset: 48 },
    ])
    assert.deepEqual(mock.divisors, Array.from({ length: 6 }, (_, location) => ({ location, divisor: 1 })))

    buffers.sync([a], () => 1, trackedPrepare)
    assert.equal(preparations, 1)
    assert.equal(buffers.chunks.get('a'), resource)
    assert.equal(mock.deletedBuffers.length, 0)
})

test('pan evicts hidden chunks and releases their exact bytes', () => {
    const mock = mockGl()
    const buffers = new ChunkBuffers(mock.gl)
    const a = chunk('a', 2)
    const b = chunk('b', 1)
    buffers.sync([a, b], () => 0, prepare)
    assert.equal(buffers.gpuBytes, 192)
    const kept = buffers.chunks.get('b')
    buffers.sync([b], () => 0, prepare)
    assert.equal(buffers.gpuBytes, 64)
    assert.equal(buffers.chunks.has('a'), false)
    assert.equal(buffers.chunks.get('b'), kept)
    assert.equal(mock.deletedBuffers.length, 1)
    assert.equal(mock.deletedVaos.length, 1)
    buffers.clear()
    assert.equal(buffers.gpuBytes, 0)
    assert.equal(buffers.chunks.size, 0)
    assert.equal(mock.deletedBuffers.length, 2)
    assert.equal(mock.deletedVaos.length, 2)

})

test('revision changes rebuild only edited migration chunks', () => {
    const mock = mockGl()
    const buffers = new ChunkBuffers(mock.gl)
    const a = chunk('source')
    const b = chunk('destination')
    const c = chunk('other')
    const revisions = new Map([['source', 0], ['destination', 0], ['other', 0]])
    const revision = (key: string) => revisions.get(key)
    buffers.sync([a, b, c], revision, prepare)
    const untouched = buffers.chunks.get('other')
    revisions.set('source', 1)
    revisions.set('destination', 1)
    buffers.sync([a, b, c], revision, prepare)
    assert.deepEqual(mock.uploads, [64, 64, 64, 64, 64])
    assert.equal(mock.deletedBuffers.length, 2)
    assert.equal(buffers.chunks.get('other'), untouched)
    assert.equal(buffers.gpuBytes, 192)
    buffers.invalidate(['source', 'destination'])
    assert.equal(buffers.gpuBytes, 64)
    assert.equal(buffers.chunks.get('other'), untouched)
})

test('same-key replacement rebuilds even with an unchanged revision', () => {
    const mock = mockGl()
    const buffers = new ChunkBuffers(mock.gl)
    buffers.sync([chunk('a', 1)], () => 5, prepare)
    buffers.sync([chunk('a', 3)], () => 5, prepare)
    assert.deepEqual(mock.uploads, [64, 192])
    assert.equal(buffers.gpuBytes, 192)
    assert.equal(buffers.chunks.get('a')?.count, 3)
    assert.equal(mock.deletedBuffers.length, 1)
})

test('failed replacement leaves no stale resource or byte accounting', () => {
    const mock = mockGl()
    const buffers = new ChunkBuffers(mock.gl)
    const a = chunk('a')
    buffers.sync([a], () => 1, prepare)
    assert.throws(() => buffers.sync([a], () => 2, () => { throw new Error('prepare failed') }), /prepare failed/)
    assert.equal(buffers.chunks.has('a'), false)
    assert.equal(buffers.gpuBytes, 0)

    mock.setFailUpload(true)
    assert.throws(() => buffers.sync([a], () => 2, prepare), /upload failed/)
    assert.equal(buffers.chunks.size, 0)
    assert.equal(buffers.gpuBytes, 0)
    assert.equal(mock.deletedBuffers.length, 2)
    assert.equal(mock.deletedVaos.length, 2)

    mock.setFailUpload(false)
    mock.setGlError(1285)
    assert.throws(() => buffers.sync([a], () => 2, prepare), /WebGL error 1285/)
    assert.equal(buffers.chunks.size, 0)
    assert.equal(buffers.gpuBytes, 0)
    assert.equal(mock.deletedBuffers.length, 3)
    assert.equal(mock.deletedVaos.length, 3)
})
