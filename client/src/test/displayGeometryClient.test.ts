import assert from 'node:assert/strict'
import test from 'node:test'
import proj4 from 'proj4'
import { DisplayGeometryClient } from '../src/core/worker/displayGeometryClient'
import { displayLayers } from '../src/core/grid/displayHierarchy'
import type { DisplayGeometryTask } from '../src/core/grid/displayGeometryEngine'
import type { GridDisplayMeta } from '../src/core/grid/displayTypes'

class ManualWorker {
    static instances: ManualWorker[] = []
    onmessage?: (event: { data: unknown }) => void
    onerror?: (event: { message: string }) => void
    onmessageerror?: () => void
    sent: { id: number; config?: unknown; task: DisplayGeometryTask; transfers: number }[] = []
    terminated = false
    constructor() { ManualWorker.instances.push(this) }
    postMessage(message: { id: number; config?: unknown; task: DisplayGeometryTask }, transfer: Transferable[] = []) {
        this.sent.push({ ...structuredClone(message, { transfer }), transfers: transfer.length })
    }
    terminate() { this.terminated = true }
    reply(data: unknown) { this.onmessage?.({ data }) }
}

test('one projection RPC accumulates a finite block stream; cancellation drops parts and late replies', async t => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'Worker')
    Object.defineProperty(globalThis, 'Worker', { value: ManualWorker, configurable: true })
    t.after(() => { if (original) Object.defineProperty(globalThis, 'Worker', original); else Reflect.deleteProperty(globalThis, 'Worker') })
    const client = new DisplayGeometryClient({ layers: displayLayers([0, 0, 2, 2], [[1, 1]], [0, 0]), origin: [0, 0], definition: JSON.stringify(proj4.defs('EPSG:3857')) })
    const selecting = client.run({ type: 'select', bounds: [0, 0, 2, 2], scale: 1e8 })
    const worker = ManualWorker.instances.at(-1)!
    assert.ok(worker.sent[0].config)
    assert.throws(() => client.run({ type: 'select', bounds: [0, 0, 2, 2], scale: 1e8 }), /Concurrent/)
    worker.reply({ id: worker.sent[0].id, result: { blocks: [] } })
    await selecting
    const chunks = ['a', 'b'].map(key => ({ key, bounds: [0, 0, 1, 1] as [number, number, number, number], cells: [], fields: [] }))
    const preparing = client.run({ type: 'prepare', chunks })
    assert.equal(worker.sent[1].config, undefined)
    assert.deepEqual(worker.sent[1].task, { type: 'prepare', chunks: [chunks[0]] })
    const id = worker.sent[1].id
    worker.reply({ id, part: { prepared: [{ data: new Float32Array(16), origin: [0, 0], corners: [], worldBounds: [0, 0, 1, 1] }] }, done: true })
    let complete = false
    void preparing.then(() => { complete = true })
    await Promise.resolve()
    assert.equal(complete, false)
    assert.deepEqual(worker.sent[2].task, { type: 'prepare', chunks: [chunks[1]] })
    assert.equal(complete, false)
    worker.reply({ id, part: { prepared: [{ data: new Float32Array(16), origin: [0, 0], corners: [], worldBounds: [0, 0, 1, 1] }] }, done: true })
    assert.equal((await preparing).prepared?.length, 2)
    const cancelled = client.run({ type: 'select', bounds: [0, 0, 2, 2], scale: 1e8 })
    client.dispose()
    await assert.rejects(cancelled, { name: 'AbortError' })
    assert.equal(worker.terminated, true)
    const next = client.run({ type: 'select', bounds: [0, 0, 2, 2], scale: 1e8 })
    const replacement = ManualWorker.instances.at(-1)!
    assert.notEqual(worker, replacement)
    assert.ok(replacement.sent[0].config)
    worker.reply({ id: worker.sent[3].id, result: { blocks: ['stale'] } })
    replacement.reply({ id: replacement.sent[0].id, result: { blocks: [] } })
    assert.deepEqual((await next).blocks, [])
    const failed = client.run({ type: 'prepare', chunks: [] })
    replacement.onerror?.({ message: 'projection failed' })
    await assert.rejects(failed, /projection failed/)
    assert.equal(replacement.terminated, true)
})

test('decode transfers one buffer after each block acknowledgment and keeps empty batches finite', async t => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'Worker')
    Object.defineProperty(globalThis, 'Worker', { value: ManualWorker, configurable: true })
    t.after(() => { if (original) Object.defineProperty(globalThis, 'Worker', original); else Reflect.deleteProperty(globalThis, 'Worker') })
    const client = new DisplayGeometryClient({ layers: displayLayers([0, 0, 3, 1], [[1, 1]], [0, 0]), origin: [0, 0], definition: JSON.stringify(proj4.defs('EPSG:4326')) })
    const blocks = [0, 1, 2].map(x => {
        const buffer = new ArrayBuffer(4)
        new DataView(buffer).setUint32(0, 0x47444e35, false)
        return { block: { blockLayer: 0, x, y: 0, displayLayer: 0 }, buffer }
    })
    const meta = { revision: 'rpc', displayLayers: displayLayers([0, 0, 3, 1], [[1, 1]], [0, 0]), alignment_origin: [0, 0], grid_info: [[1, 1]] } as GridDisplayMeta
    const decoding = client.run({ type: 'decode', blocks, meta, knownOriginals: [41] })
    const worker = ManualWorker.instances.at(-1)!
    const id = worker.sent[0].id
    assert.equal(worker.sent.length, 1)
    assert.equal(worker.sent[0].transfers, 1)
    assert.deepEqual(blocks.map(item => item.buffer.byteLength), [0, 4, 4])
    assert.deepEqual((worker.sent[0].task as Extract<DisplayGeometryTask, { type: 'decode' }>).knownOriginals, [41])
    assert.throws(() => client.run({ type: 'decode', blocks: [], meta }), /Concurrent/)
    for (let i = 0; i < 3; i++) {
        const task = worker.sent[i].task
        assert.equal(task.type, 'decode')
        if (task.type !== 'decode') throw new Error('Expected decode input')
        const decoded = task.blocks[0].buffer
        worker.reply(structuredClone({ id, decoded, part: { prepared: [] }, done: true }, { transfer: [decoded] }))
        assert.equal(worker.sent.length, Math.min(i + 2, 3))
        assert.deepEqual(blocks.map(item => item.buffer.byteLength), blocks.map((_, index) => index <= i + 1 ? 0 : 4))
        if (i < 2) assert.equal(worker.sent[i + 1].id, id)
        if (i < 2) assert.equal((worker.sent[i + 1].task as Extract<DisplayGeometryTask, { type: 'decode' }>).knownOriginals, undefined)
    }
    assert.deepEqual((await decoding).decodedBlocks?.map(block => block.chunks), [[], [], []])
    const empty = client.run({ type: 'decode', blocks: [], meta })
    assert.equal(worker.sent.at(-1)?.transfers, 0)
    worker.reply({ id: worker.sent.at(-1)?.id, done: true })
    assert.deepEqual(await empty, { decodedBlocks: [] })
    client.dispose()
})
