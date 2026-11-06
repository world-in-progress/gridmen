import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { Worker as ThreadWorker } from 'node:worker_threads'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import proj4 from 'proj4'
import { displayLayers } from '../src/core/grid/displayHierarchy'
import { DisplayGeometryClient } from '../src/core/worker/displayGeometryClient'
import type { DisplayGeometryConfig, DisplayGeometryTask, DisplayGeometryEngine } from '../src/core/grid/displayGeometryEngine'
import type { DisplayBlock, DisplayChunk, GridDisplayMeta } from '../src/core/grid/displayTypes'

const root = process.cwd()
const output = resolve(root, '../../.verification/resume-rpc')
const modulePath = resolve(output, 'displayGeometry.worker.mjs')
const shimPath = resolve(output, 'worker-shim.mjs')
let buildPromise: Promise<void> | undefined
type WorkerReply = { id: number; part?: ReturnType<DisplayGeometryEngine['run']>; result?: ReturnType<DisplayGeometryEngine['run']>; done?: boolean; error?: string }

function buildWorker(): Promise<void> {
    return buildPromise ??= (async () => {
        await mkdir(output, { recursive: true })
        const { build } = createRequire(resolve(root, 'package.json'))('esbuild') as typeof import('esbuild')
        await build({ entryPoints: [resolve(root, 'src/core/worker/displayGeometry.worker.ts')], outfile: modulePath,
            bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
        await writeFile(shimPath, `import { parentPort } from 'node:worker_threads'
globalThis.self = { postMessage: (message, transfer) => parentPort.postMessage(message, transfer), onmessage: null }
parentPort.on('message', data => globalThis.self.onmessage?.({ data }))
await import('./displayGeometry.worker.mjs')
`)
    })()
}

class ProductionWorker {
    static instances: ProductionWorker[] = []
    onmessage?: (event: { data: WorkerReply }) => void
    onerror?: (event: { message: string }) => void
    onmessageerror?: () => void
    readonly sent: { id: number; config?: DisplayGeometryConfig; task: DisplayGeometryTask; transfers: number }[] = []
    readonly received: WorkerReply[] = []
    readonly heldDone: WorkerReply[] = []
    private readonly thread = new ThreadWorker(shimPath, { type: 'module' })
    constructor() {
        ProductionWorker.instances.push(this)
        this.thread.on('message', (data: WorkerReply) => {
            this.received.push(data)
            if (data.done) this.heldDone.push(data)
            else this.onmessage?.({ data })
        })
        this.thread.on('error', error => this.onerror?.({ message: error.message }))
        this.thread.on('messageerror', () => this.onmessageerror?.())
    }
    postMessage(message: { id: number; config?: DisplayGeometryConfig; task: DisplayGeometryTask }, transfer: ArrayBuffer[] = []) {
        this.sent.push({ ...message, transfers: transfer.length })
        this.thread.postMessage(message, transfer)
    }
    releaseDone() { const data = this.heldDone.shift(); assert.ok(data, 'expected a block acknowledgment'); this.onmessage?.({ data }) }
    terminate() { void this.thread.terminate() }
    close() { return this.thread.terminate() }
}

async function fixture(t: { after(fn: () => void | Promise<void>): void }) {
    await buildWorker()
    const original = Object.getOwnPropertyDescriptor(globalThis, 'Worker')
    const first = ProductionWorker.instances.length
    Object.defineProperty(globalThis, 'Worker', { value: ProductionWorker, configurable: true })
    t.after(async () => {
        if (original) Object.defineProperty(globalThis, 'Worker', original)
        else Reflect.deleteProperty(globalThis, 'Worker')
        await Promise.all(ProductionWorker.instances.slice(first).map(worker => worker.close()))
    })
}

async function until(check: () => boolean) {
    const deadline = Date.now() + 5000
    while (!check()) {
        assert.ok(Date.now() < deadline, 'timed out waiting for the production worker')
        await new Promise(resolve => setTimeout(resolve, 5))
    }
}

const layers = displayLayers([0, 0, 3, 1], [[1, 1]], [0, 0])
const meta = { revision: 'rpc', displayLayers: layers, alignment_origin: [0, 0], grid_info: [[1, 1]], cellCount: 3 } as GridDisplayMeta
const config = (crs: string): DisplayGeometryConfig => ({ layers, origin: [0, 0], definition: JSON.stringify(proj4.defs(crs)) })
const block = (x: number): DisplayBlock => ({ blockLayer: 0, x, y: 0, displayLayer: 0 })

function gdn4(id: number, x: number): ArrayBuffer {
    const buffer = new ArrayBuffer(80), data = new DataView(buffer)
    data.setUint32(0, 0x47444e34, false)
    data.setUint32(4, 1, true)
    data.setBigUint64(8, BigInt(id), true)
    ;[x, 0, x + 1, 1].forEach((value, i) => data.setFloat64(16 + 8 * i, value, true))
    data.setFloat64(48, 1, true)
    data.setFloat64(56, id * 2, true)
    data.setFloat64(64, 1, true)
    data.setUint32(72, 1, true)
    data.setUint32(76, id, true)
    return buffer
}

const chunk = (x: number): DisplayChunk => ({ key: String(x), bounds: [x, 0, x + 1, 1],
    cells: [{ id: x + 1, bounds: [x, 0, x + 1, 1], level: 1, elevation: x + 10, landClass: x }], fields: [] })

test('production worker decodes transferred GDN4 blocks in acknowledged order, including an empty batch', async t => {
    await fixture(t)
    const client = new DisplayGeometryClient(config('EPSG:4326'))
    t.after(() => client.dispose())
    const blocks = [0, 1, 2].map(x => ({ block: block(x), buffer: gdn4(x + 1, x) }))
    const result = client.run({ type: 'decode', blocks, meta })
    const worker = ProductionWorker.instances.at(-1)!
    const id = worker.sent[0].id
    assert.equal(worker.sent[0].transfers, 1)
    assert.deepEqual(blocks.map(item => item.buffer.byteLength), [0, 80, 80])
    const detachedStages = [blocks.map(item => item.buffer.byteLength)]
    for (let i = 0; i < blocks.length; i++) {
        await until(() => worker.heldDone.length === 1)
        assert.equal(worker.sent.length, i + 1)
        assert.equal(worker.received.at(-1)?.id, id)
        assert.equal(worker.received.at(-1)?.part?.chunks?.[0].cells[0].id, i + 1)
        assert.equal(worker.received.at(-1)?.done, true)
        worker.releaseDone()
        assert.equal(worker.sent.length, Math.min(i + 2, blocks.length))
        assert.deepEqual(blocks.map(item => item.buffer.byteLength), blocks.map((_, index) => index <= i + 1 ? 0 : 80))
        detachedStages.push(blocks.map(item => item.buffer.byteLength))
    }
    const decoded = await result
    assert.deepEqual(decoded.chunks?.map(item => item.key), ['0:0:0:0', '0:1:0:0', '0:2:0:0'])
    assert.deepEqual(decoded.prepared?.map(item => item.data[9]), [2, 4, 6])
    assert.ok(decoded.prepared?.every(item => item.data.byteLength === 64))
    const empty = client.run({ type: 'decode', blocks: [], meta })
    assert.equal(worker.sent.at(-1)?.transfers, 0)
    await until(() => worker.heldDone.length === 1)
    worker.releaseDone()
    assert.deepEqual(await empty, { chunks: [], prepared: [] })
    await writeFile(resolve(output, 'decode-stream.json'), JSON.stringify({
        detachedStages,
        sent: worker.sent.map(message => ({ id: message.id, type: message.task.type,
            blocks: message.task.type === 'decode' ? message.task.blocks.length : 0, transfers: message.transfers })),
        received: worker.received.map(message => ({ id: message.id, done: !!message.done,
            chunks: message.part?.chunks?.map(chunk => chunk.key) ?? [],
            preparedBytes: message.part?.prepared?.reduce((sum, chunk) => sum + chunk.data.byteLength, 0) ?? 0 })),
    }, null, 2) + '\n')
})

test('production worker prepares one chunk after each acknowledgment', async t => {
    await fixture(t)
    const client = new DisplayGeometryClient(config('EPSG:4326'))
    t.after(() => client.dispose())
    const result = client.run({ type: 'prepare', chunks: [chunk(0), chunk(1), chunk(2)] })
    const worker = ProductionWorker.instances.at(-1)!
    const id = worker.sent[0].id
    for (let i = 0; i < 3; i++) {
        await until(() => worker.heldDone.length === 1)
        assert.equal(worker.sent.length, i + 1)
        assert.equal(worker.sent[i].id, id)
        assert.equal(worker.sent[i].transfers, 0)
        assert.equal(worker.received.at(-1)?.part?.prepared?.[0].data[9], i + 10)
        worker.releaseDone()
    }
    assert.deepEqual((await result).prepared?.map(item => item.data[9]), [10, 11, 12])
    const empty = client.run({ type: 'prepare', chunks: [] })
    await until(() => worker.heldDone.length === 1)
    worker.releaseDone()
    assert.deepEqual(await empty, { chunks: [], prepared: [] })
})

test('a middle GDN4 failure stops the stream before transferring later blocks', async t => {
    await fixture(t)
    const client = new DisplayGeometryClient(config('EPSG:4326'))
    t.after(() => client.dispose())
    const blocks = [{ block: block(0), buffer: gdn4(1, 0) },
        { block: block(1), buffer: new ArrayBuffer(8) }, { block: block(2), buffer: gdn4(3, 2) }]
    const result = client.run({ type: 'decode', blocks, meta })
    const worker = ProductionWorker.instances.at(-1)!
    await until(() => worker.heldDone.length === 1)
    worker.releaseDone()
    await assert.rejects(result, /grid display format/)
    assert.equal(worker.sent.length, 2)
    assert.deepEqual(blocks.map(item => item.buffer.byteLength), [0, 0, 80])
    const recovered = client.run({ type: 'decode', blocks: [blocks[2]], meta })
    await until(() => worker.heldDone.length === 1)
    worker.releaseDone()
    assert.deepEqual((await recovered).chunks?.map(item => item.cells[0].id), [3])
})

test('an obsolete camera stops at the current block acknowledgment without discarding worker geometry state', async t => {
    await fixture(t)
    const client = new DisplayGeometryClient(config('EPSG:4326'))
    t.after(() => client.dispose())
    let current = true
    const blocks = [0, 1, 2].map(x => ({ block: block(x), buffer: gdn4(x + 1, x) }))
    const result = client.run({ type: 'decode', blocks, meta }, () => current)
    const worker = ProductionWorker.instances.at(-1)!
    await until(() => worker.heldDone.length === 1)
    current = false
    worker.releaseDone()
    await assert.rejects(result, { name: 'AbortError' })
    assert.equal(worker.sent.length, 1)
    assert.deepEqual(blocks.map(item => item.buffer.byteLength), [0, 80, 80])
    assert.deepEqual(await client.run({ type: 'reset' }), {})
    assert.equal(ProductionWorker.instances.at(-1), worker)
    assert.equal(worker.sent.at(-1)?.config, undefined)
})

test('disposal between blocks drops late replies; recreated workers keep source projection isolated', async t => {
    await fixture(t)
    const first = new DisplayGeometryClient(config('EPSG:4326'))
    const blocks = [{ block: block(0), buffer: gdn4(1, 0) }, { block: block(1), buffer: gdn4(2, 1) }]
    const cancelled = first.run({ type: 'decode', blocks, meta })
    const oldWorker = ProductionWorker.instances.at(-1)!
    await until(() => oldWorker.heldDone.length === 1)
    first.dispose()
    await assert.rejects(cancelled, { name: 'AbortError' })
    assert.equal(blocks[1].buffer.byteLength, 80)
    const a = first.run({ type: 'prepare', chunks: [chunk(0)] })
    const nextWorker = ProductionWorker.instances.at(-1)!
    assert.notEqual(oldWorker, nextWorker)
    assert.ok(nextWorker.sent[0].config)
    oldWorker.onmessage?.({ data: { id: oldWorker.sent[0].id, part: { prepared: [
        { data: new Float32Array(16), origin: [0, 0], corners: [], worldBounds: [0, 0, 0, 0] },
    ] } } })
    oldWorker.releaseDone()
    assert.equal(nextWorker.sent.length, 1)
    await until(() => nextWorker.heldDone.length === 1)
    nextWorker.releaseDone()
    const aBounds = (await a).prepared![0].worldBounds
    const second = new DisplayGeometryClient(config('EPSG:3857'))
    t.after(() => { first.dispose(); second.dispose() })
    const b = second.run({ type: 'prepare', chunks: [chunk(0)] })
    const otherWorker = ProductionWorker.instances.at(-1)!
    assert.notEqual(nextWorker, otherWorker)
    assert.notDeepEqual(otherWorker.sent[0].config?.definition, nextWorker.sent[0].config?.definition)
    await until(() => otherWorker.heldDone.length === 1)
    otherWorker.releaseDone()
    const bBounds = (await b).prepared![0].worldBounds
    assert.ok(aBounds[2] - aBounds[0] > (bBounds[2] - bBounds[0]) * 1000)
})
