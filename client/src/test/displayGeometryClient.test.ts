import assert from 'node:assert/strict'
import test from 'node:test'
import proj4 from 'proj4'
import { DisplayGeometryClient } from '../src/core/worker/displayGeometryClient'
import { displayLayers } from '../src/core/grid/displayHierarchy'
import type { DisplayGeometryTask } from '../src/core/grid/displayGeometryEngine'

class ManualWorker {
    static instances: ManualWorker[] = []
    onmessage?: (event: { data: unknown }) => void
    onerror?: (event: { message: string }) => void
    onmessageerror?: () => void
    sent: { id: number; config?: unknown; task: DisplayGeometryTask }[] = []
    terminated = false
    constructor() { ManualWorker.instances.push(this) }
    postMessage(message: { id: number; config?: unknown; task: DisplayGeometryTask }) { this.sent.push(message) }
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
    worker.reply({ id, part: { prepared: [{ data: new Float32Array(16), origin: [0, 0], corners: [], worldBounds: [0, 0, 1, 1] }] } })
    let complete = false
    void preparing.then(() => { complete = true })
    await Promise.resolve()
    assert.equal(complete, false)
    worker.reply({ id, done: true })
    assert.deepEqual(worker.sent[2].task, { type: 'prepare', chunks: [chunks[1]] })
    assert.equal(complete, false)
    worker.reply({ id, part: { prepared: [{ data: new Float32Array(16), origin: [0, 0], corners: [], worldBounds: [0, 0, 1, 1] }] } })
    worker.reply({ id, done: true })
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
