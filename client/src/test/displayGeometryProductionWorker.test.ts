import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import test, { after } from 'node:test'
import { Worker as ThreadWorker } from 'node:worker_threads'
import proj4 from 'proj4'
import { displayLayers } from '../src/core/grid/displayHierarchy'
import { DisplayGeometryEngine, type DisplayGeometryConfig, type DisplayGeometryTask } from '../src/core/grid/displayGeometryEngine'
import { DisplayGeometryClient } from '../src/core/worker/displayGeometryClient'
import type { DisplayGeometryReply } from '../src/core/worker/displayGeometryProtocol'
import type { DisplayBlock, DisplayChunk, GridDisplayMeta } from '../src/core/grid/displayTypes'

const root = process.cwd()
let buildPromise: Promise<{ directory: string; shim: string }> | undefined
async function buildWorker(): Promise<{ directory: string; shim: string }> {
    return buildPromise ??= (async () => {
        const directory = await mkdtemp(join(tmpdir(), 'gridmen-display-worker-'))
        try {
            const modulePath = join(directory, 'displayGeometry.worker.mjs')
            const shim = join(directory, 'worker-shim.mjs')
            const { build } = createRequire(resolve(root, 'package.json'))('esbuild') as typeof import('esbuild')
            await build({ entryPoints: [resolve(root, 'src/core/worker/displayGeometry.worker.ts')], outfile: modulePath,
                bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
            await writeFile(shim, `import { parentPort } from 'node:worker_threads'
globalThis.self = { postMessage(message, transfer = []) { parentPort.postMessage(message, transfer) }, onmessage: null }
parentPort.on('message', data => globalThis.self.onmessage?.({ data }))
await import('./displayGeometry.worker.mjs')
`)
            return { directory, shim }
        } catch (error) {
            await rm(directory, { recursive: true, force: true })
            throw error
        }
    })()
}
after(async () => {
    if (buildPromise) {
        try {
            const { directory } = await buildPromise
            await rm(directory, { recursive: true, force: true })
        } catch { /* failed builds remove their own temporary directory */ }
    }
})

class ProductionWorker {
    static instances: ProductionWorker[] = []
    onmessage?: (event: { data: DisplayGeometryReply }) => void
    onerror?: (event: { message: string }) => void
    onmessageerror?: () => void
    readonly sent: { id: number; task: DisplayGeometryTask }[] = []
    readonly received: DisplayGeometryReply[] = []
    readonly heldDone: DisplayGeometryReply[] = []
    holdDone = false
    terminated = false
    private readonly thread: ThreadWorker

    constructor(shim: string) {
        this.thread = new ThreadWorker(shim, { type: 'module' })
        ProductionWorker.instances.push(this)
        this.thread.on('message', (data: DisplayGeometryReply) => {
            this.received.push(data)
            if (data.done && this.holdDone) this.heldDone.push(data)
            else this.onmessage?.({ data })
        })
        this.thread.on('error', error => this.onerror?.({ message: error.message }))
        this.thread.on('messageerror', () => this.onmessageerror?.())
    }
    postMessage(message: { id: number; task: DisplayGeometryTask }, transfer: ArrayBuffer[] = []) {
        this.sent.push({ id: message.id, task: message.task })
        this.thread.postMessage(message, transfer)
    }
    releaseDone() {
        const data = this.heldDone.shift()
        assert.ok(data, 'expected a block acknowledgment')
        this.onmessage?.({ data })
    }
    terminate() { this.terminated = true; void this.thread.terminate() }
    close() { return this.thread.terminate() }
}

async function fixture(t: { after(fn: () => void | Promise<void>): void }, holdDone = false) {
    const { shim } = await buildWorker()
    const original = Object.getOwnPropertyDescriptor(globalThis, 'Worker')
    const first = ProductionWorker.instances.length
    class WorkerFixture extends ProductionWorker {
        constructor() { super(shim); this.holdDone = holdDone }
    }
    Object.defineProperty(globalThis, 'Worker', { value: WorkerFixture, configurable: true })
    t.after(async () => {
        if (original) Object.defineProperty(globalThis, 'Worker', original)
        else Reflect.deleteProperty(globalThis, 'Worker')
        await Promise.all(ProductionWorker.instances.slice(first).map(worker => worker.close()))
    })
}

async function until(check: () => boolean) {
    const deadline = Date.now() + 5000
    while (!check()) {
        assert.ok(Date.now() < deadline, 'timed out waiting for production worker')
        await new Promise(resolve => setTimeout(resolve, 5))
    }
}

const layers = displayLayers([0, 0, 3, 1], [[1, 1]], [0, 0])
const meta = { revision: 'rpc', displayLayers: layers, alignment_origin: [0, 0], grid_info: [[1, 1]] } as GridDisplayMeta
const config = (): DisplayGeometryConfig => ({ layers, origin: [0, 0], definition: JSON.stringify(proj4.defs('EPSG:4326')) })
const block = (x: number): DisplayBlock => ({ blockLayer: 0, x, y: 0, displayLayer: 0 })
interface Sample { id: number; bounds: [number, number, number, number]; occupied: number; elevationArea: number; minCellSize: number; level: number; landClass: number }
function wire(samples: Sample[]): ArrayBuffer {
    const buffer = new ArrayBuffer(4 + samples.length * 72), data = new DataView(buffer)
    data.setUint32(0, 0x47444e35, false)
    samples.forEach((sample, index) => {
        const offset = 4 + index * 72
        data.setBigUint64(offset, BigInt(sample.id), true)
        sample.bounds.forEach((value, coordinate) => data.setFloat64(offset + 8 + coordinate * 8, value, true))
        data.setFloat64(offset + 40, sample.occupied, true)
        data.setFloat64(offset + 48, sample.elevationArea, true)
        data.setFloat64(offset + 56, sample.minCellSize, true)
        data.setUint32(offset + 64, sample.level, true)
        data.setUint32(offset + 68, sample.landClass, true)
    })
    return buffer
}
function original(id: number, bounds: Sample['bounds'], elevation: number): Sample {
    return { id, bounds, occupied: (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]),
        elevationArea: (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]) * elevation,
        minCellSize: 0.25, level: 1, landClass: 7 }
}
function field(bounds: Sample['bounds'], elevation: number): Sample {
    const area = (bounds[2] - bounds[0]) * (bounds[3] - bounds[1])
    return { id: 0, bounds, occupied: area / 3, elevationArea: area / 3 * elevation,
        minCellSize: 0.125, level: 1, landClass: 4 }
}

const crossing = original(42, [0.5, 0.25, 1.5, 0.75], 12.123456789)
const known = original(99, [0.75, 0.5, 1.25, 0.875], -4.25)
function sampleBlocks() {
    return [
        { block: block(0), buffer: wire([field([0.1250000001, 0.125, 0.375, 0.375], 2.123456789),
            original(1, [0, 0, 0.125, 0.125], 5), crossing, known]) },
        { block: block(1), buffer: wire([field([1.125, 0.125, 1.375, 0.375], 3.123456789),
            original(2, [1.5, 0, 1.625, 0.125], 6), crossing, known]) },
    ]
}

test('production worker matches in-process canonical decode and exact geometry', async t => {
    await fixture(t)
    const client = new DisplayGeometryClient(config())
    t.after(() => client.dispose())
    const blocks = sampleBlocks()
    const expected = new DisplayGeometryEngine(config()).run({ type: 'decode', blocks, meta, knownOriginals: [99] }).decodedBlocks
    const actual = (await client.run({ type: 'decode', blocks: sampleBlocks(), meta, knownOriginals: [99] })).decodedBlocks
    const worker = ProductionWorker.instances.at(-1)!
    assert.equal(worker.received.length, 2, 'one acknowledgment per wire input')
    assert.ok(worker.received.every(reply => reply.decoded instanceof ArrayBuffer && !reply.result && !('chunks' in reply.part!)))
    assert.deepEqual(actual, expected)
    assert.deepEqual(actual?.map(group => group.chunks.map(chunk => chunk.key)), [
        ['0:0:0:0', 'original:42', 'original:99'], ['0:1:0:0', 'original:42', 'original:99'],
    ])
    assert.deepEqual(actual?.map(group => group.prepared.map(value => !!value)), [[true, true, false], [true, false, false]])
    assert.deepEqual(actual?.[0].chunks[1].bounds, crossing.bounds)
    assert.notEqual(actual?.[0].chunks[0].fields[0].bounds[0], Math.fround(actual![0].chunks[0].fields[0].bounds[0]))
    assert.equal(actual?.[0].chunks[0].fields[0].elevation, expected?.[0].chunks[0].fields[0].elevation)
})

test('production worker rejects malformed GDN5 before accepting another block', async t => {
    await fixture(t)
    const client = new DisplayGeometryClient(config())
    t.after(() => client.dispose())
    const invalid = [new ArrayBuffer(3), wire([crossing]).slice(0, 75), wire([crossing])]
    new DataView(invalid[2]).setUint32(0, 0x47444e34, false)
    for (const buffer of invalid) {
        const later = wire([original(2, [1, 0, 2, 1], 6)])
        const result = client.run({ type: 'decode', blocks: [{ block: block(0), buffer }, { block: block(1), buffer: later }], meta })
        await assert.rejects(result, /grid display (header|record length|format)/i)
        assert.ok(later.byteLength > 0)
    }
    const recovered = await client.run({ type: 'decode', blocks: [{ block: block(0), buffer: wire([crossing]) }], meta })
    assert.equal(recovered.decodedBlocks?.[0].chunks[0].cells[0].id, 42)
})

test('superseded decode stops at the current block acknowledgment', async t => {
    await fixture(t, true)
    const client = new DisplayGeometryClient(config())
    t.after(() => client.dispose())
    const blocks = [0, 1, 2].map(x => ({ block: block(x), buffer: wire([original(x + 1, [x, 0, x + 1, 1], x + 1)]) }))
    let current = true
    const result = client.run({ type: 'decode', blocks, meta }, () => current)
    const worker = ProductionWorker.instances.at(-1)!
    await until(() => worker.heldDone.length === 1)
    current = false
    worker.releaseDone()
    await assert.rejects(result, { name: 'AbortError' })
    assert.equal(worker.sent.length, 1)
    assert.deepEqual(blocks.map(item => item.buffer.byteLength === 0), [true, false, false])
    assert.deepEqual(await client.run({ type: 'reset' }), {})
    assert.equal(ProductionWorker.instances.at(-1), worker)
})

test('dispose drops a late reply while a new worker handles the next task', async t => {
    await fixture(t, true)
    const client = new DisplayGeometryClient(config())
    t.after(() => client.dispose())
    const cancelled = client.run({ type: 'decode', blocks: sampleBlocks(), meta })
    const oldWorker = ProductionWorker.instances.at(-1)!
    await until(() => oldWorker.heldDone.length === 1)
    client.dispose()
    await assert.rejects(cancelled, { name: 'AbortError' })
    assert.equal(oldWorker.terminated, true)
    const chunk: DisplayChunk = { key: 'next', bounds: [0, 0, 1, 1], cells: [], fields: [] }
    const next = client.run({ type: 'prepare', chunks: [chunk] })
    const newWorker = ProductionWorker.instances.at(-1)!
    assert.notEqual(newWorker, oldWorker)
    oldWorker.releaseDone()
    await until(() => newWorker.heldDone.length === 1)
    newWorker.releaseDone()
    assert.equal((await next).prepared?.length, 1)
})
