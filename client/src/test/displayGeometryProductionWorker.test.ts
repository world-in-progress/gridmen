import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { Worker as ThreadWorker } from 'node:worker_threads'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import proj4 from 'proj4'
import type { Converter } from 'proj4/dist/lib/core'
import DisplayIndex from '../src/core/grid/displayIndex'
import TopologyLayer from '../src/views/mapView/topology/TopologyLayer'
import { MercatorCoordinate } from '../src/core/math/mercatorCoordinate'
import { displayLayers } from '../src/core/grid/displayHierarchy'
import { DisplayGeometryClient } from '../src/core/worker/displayGeometryClient'
import type { DisplayGeometryConfig, DisplayGeometryTask, DisplayGeometryEngine, PreparedDisplayChunk } from '../src/core/grid/displayGeometryEngine'
import type { DisplayBlock, DisplayCell, DisplayChunk, GridDisplayMeta, GridDisplayView, ReadOnlyGridSource } from '../src/core/grid/displayTypes'

const root = process.cwd()
const output = process.env.GRID_TEST_EVIDENCE ? resolve(process.env.GRID_TEST_EVIDENCE, 'production-worker') : resolve(root, '../../.verification/resume-rpc')
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
    holdDone = true
    terminated = false
    private readonly thread = new ThreadWorker(shimPath, { type: 'module' })
    constructor() {
        ProductionWorker.instances.push(this)
        this.thread.on('message', (data: WorkerReply) => {
            this.received.push(data)
            if (data.done && this.holdDone) this.heldDone.push(data)
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
    terminate() { this.terminated = true; void this.thread.terminate() }
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

class LayerCamera {
    zoom = 10
    canvas = Object.assign(new EventTarget(), { width: 256, height: 256, clientWidth: 256, clientHeight: 256 })
    getCanvas() { return this.canvas }
    triggerRepaint() {}
    isMoving() { return false }
    getProjection() { return { name: 'mercator' } }
    getPitch() { return 0 }
    getBearing() { return 0 }
    getZoom() { return this.zoom }
    off() {}
    unproject([x, y]: [number, number]) {
        const scale = 2 ** (this.zoom - 10)
        return { lng: x / scale / 128, lat: MercatorCoordinate.latFromMercatorY(0.5 + y / scale / 46080) }
    }
    project([lng, lat]: [number, number]) {
        const scale = 2 ** (this.zoom - 10)
        return { x: lng * 128 * scale, y: (MercatorCoordinate.mercatorYfromLat(lat) - 0.5) * 46080 * scale }
    }
}

// Only DOM and the public camera are stubbed. The index, layer, client, worker
// entry point, structured cloning and returned geometry all run unchanged.
interface LayerState {
    _index: DisplayIndex
    _projection: Converter
    _projectionDefinition: string
    _dataReady: boolean
    _editVersion: number
    _lastSettledCamera?: string
    _view: GridDisplayView
    _blocks: DisplayBlock[]
    _prepared: Map<DisplayChunk, PreparedDisplayChunk>
    _geometry?: DisplayGeometryClient
    _viewPromise?: Promise<void>
    _pendingView: boolean
    requestView(): void
    refreshView(): Promise<void>
    _cameraChanged(): void
}

async function layerFixture(t: { after(fn: () => void | Promise<void>): void }, readonly = false) {
    await fixture(t)
    class AutomaticWorker extends ProductionWorker { constructor() { super(); this.holdDone = false } }
    Object.defineProperty(globalThis, 'Worker', { value: AutomaticWorker, configurable: true })
    const frames = new Map<number, FrameRequestCallback>()
    let nextFrame = 0
    const globals = {
        window: new EventTarget(),
        requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame },
        cancelAnimationFrame: (id: number) => { frames.delete(id) },
    }
    const originals = Object.getOwnPropertyDescriptors(globalThis)
    for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
    const camera = new LayerCamera(), layer = new TopologyLayer(camera as never), state = layer as unknown as LayerState
    const meta: GridDisplayMeta = {
        revision: 'layer-prepare', epsg: 4326, bounds: [-8, -8, 16, 8], alignment_origin: [0, 0],
        grid_info: [[1, 1], [0.25, 0.25]], displayLayers: displayLayers([-8, -8, 16, 8], [[1, 1], [0.25, 0.25]], [0, 0]),
        level_info: [{ width: 24, height: 16 }, { width: 96, height: 64 }], subdivide_rules: [[4, 4]],
        cellCount: 24, attributes: ['level', 'elevation', 'landClass'], elevationRange: [0, 1000], landClasses: [5],
    }
    const cells: DisplayCell[] = Array.from({ length: 24 }, (_, id) => ({ id, level: 1, elevation: id, landClass: 5,
        bounds: [(id % 6) * 0.25, -Math.floor(id / 6) * 0.25 - 0.25, (id % 6 + 1) * 0.25, -Math.floor(id / 6) * 0.25] }))
    const index = new DisplayIndex(meta.bounds, meta)
    index.load(cells)
    const errors: unknown[] = []
    // An immutable readonly canonical view can need prepare after original
    // deduplication. Supplying it here exercises that layer call site directly.
    const source = (revision = meta.revision): ReadOnlyGridSource => ({
        meta: { ...meta, revision },
        loadBlocks: async blocks => index.queryBlocks(blocks, true),
        inspect: async () => ({ cell: null, neighbors: [] }),
        reportError: error => { errors.push(error) },
    })
    t.after(() => {
        layer.remove(camera as never, undefined as never)
        for (const key of Object.keys(globals)) {
            if (originals[key]) Object.defineProperty(globalThis, key, originals[key])
            else Reflect.deleteProperty(globalThis, key)
        }
    })
    layer.initialized = true
    if (readonly) await layer.setReadOnlySource(source())
    else {
        state._index = index
        state._projection = proj4('EPSG:4326', 'EPSG:4326')
        state._projectionDefinition = JSON.stringify(proj4.defs('EPSG:4326'))
        state._dataReady = true
        state.requestView()
        await until(() => layer.isReady)
    }
    const worker = (state._geometry as unknown as { worker: ProductionWorker }).worker
    const revise = (elevation: number, all = false) => {
        for (const cell of all ? cells : cells.slice(0, 1)) index.upsert({ ...cell, elevation })
        if (!readonly) state._editVersion++
        state._lastSettledCamera = undefined
        state.requestView()
    }
    const holdFirstPrepare = async () => {
        worker.holdDone = true
        revise(901, true)
        const missing = index.queryBlocks(state._blocks, true).chunks.filter(chunk => !state._prepared.has(chunk)).length
        assert.equal(missing, 6, 'all six changed original chunks must require preparation')
        await until(() => worker.heldDone.length === 1)
        const id = worker.heldDone[0].id
        assert.equal(worker.sent.filter(message => message.id === id).length, 1)
        return { id, missing }
    }
    const zoom = () => {
        camera.zoom = 11
        state._cameraChanged()
        const callbacks = [...frames.values()]
        frames.clear()
        callbacks.forEach(callback => callback(performance.now()))
    }
    const assertComplete = (firstElevation: number) => {
        assert.equal(layer.isReady, true)
        assert.equal(state._dataReady, true)
        assert.deepEqual(errors, [])
        const final = state._view.chunks.flatMap(chunk => chunk.cells).sort((a, b) => a.id - b.id)
        const expected = index.queryBlocks(state._blocks, true).chunks.flatMap(chunk => chunk.cells).sort((a, b) => a.id - b.id)
        assert.ok(final.length > 0)
        assert.deepEqual(final.map(cell => cell.id), expected.map(cell => cell.id), 'no visible original may disappear while draining the latest view')
        for (const cell of final) assert.equal(cell.elevation, cell.id === 0 ? firstElevation : 901)
        for (const chunk of state._view.chunks) {
            const prepared = state._prepared.get(chunk)
            assert.ok(prepared)
            chunk.cells.forEach((cell, row) => assert.equal(prepared.data[row * 16 + 9], cell.elevation))
        }
    }
    return { camera, layer, state, index, cells, worker, source, revise, holdFirstPrepare, zoom, assertComplete }
}

function trace(worker: ProductionWorker) {
    return {
        sent: worker.sent.map(({ id, task, config, transfers }) => ({ id, type: task.type, config: !!config, transfers,
            keys: task.type === 'prepare' ? task.chunks.map(chunk => chunk.key) : [] })),
        received: worker.received.map(reply => ({ id: reply.id, done: !!reply.done, error: reply.error,
            preparedBytes: reply.part?.prepared?.reduce((sum, chunk) => sum + chunk.data.byteLength, 0) ?? 0 })),
        terminated: worker.terminated,
    }
}

for (const change of ['zoom', 'edit'] as const) test(`production layer stops obsolete prepare blocks after only ${change} changes at the first ACK`, async t => {
    const f = await layerFixture(t)
    const { id, missing } = await f.holdFirstPrepare()
    const sentAtChange = f.worker.sent.length
    const editVersion = f.state._editVersion
    if (change === 'zoom') f.zoom()
    else f.revise(902)
    f.worker.holdDone = false
    f.worker.releaseDone()
    await until(() => f.layer.isReady)
    const obsolete = f.worker.sent.filter(message => message.id === id)
    const staleAfterChange = f.worker.sent.slice(sentAtChange).filter(message => message.id === id).length
    const finalCells = f.state._view.chunks.flatMap(chunk => chunk.cells)
    await writeFile(resolve(output, `layer-prepare-${change}.json`), JSON.stringify({ change, initialMissing: missing, obsoleteSent: obsolete.length,
        staleSentAfterChange: staleAfterChange, skipped: missing - obsolete.length, finalReady: f.layer.isReady, originalCount: finalCells.length,
        firstElevation: finalCells.find(cell => cell.id === 0)?.elevation, ...trace(f.worker) }, null, 2) + '\n')
    assert.equal(obsolete.length, 1, 'the remaining five blocks of the obsolete snapshot must stay unsent')
    assert.equal(staleAfterChange, 0)
    assert.equal(f.camera.zoom, change === 'zoom' ? 11 : 10)
    assert.equal(f.state._editVersion, editVersion + (change === 'edit' ? 1 : 0))
    assert.equal((f.state._geometry as unknown as { worker: ProductionWorker }).worker, f.worker)
    assert.equal(f.worker.terminated, false)
    assert.equal(f.worker.sent.filter(message => message.config).length, 1, 'normal supersession must preserve worker selector state')
    f.assertComplete(change === 'edit' ? 902 : 901)
})

test('readonly canonical originals stop obsolete prepare at the camera ACK boundary', async t => {
    const f = await layerFixture(t, true)
    const { id, missing } = await f.holdFirstPrepare()
    f.zoom()
    f.worker.holdDone = false
    f.worker.releaseDone()
    await until(() => f.layer.isReady)
    const obsoleteSent = f.worker.sent.filter(message => message.id === id).length
    await writeFile(resolve(output, 'layer-prepare-readonly.json'), JSON.stringify({ initialMissing: missing, obsoleteSent, skipped: missing - obsoleteSent,
        finalReady: f.layer.isReady, ...trace(f.worker) }, null, 2) + '\n')
    assert.equal(obsoleteSent, 1)
    assert.equal(f.worker.terminated, false)
    f.assertComplete(901)
})

test('removing the layer during a prepare ACK drops the late result and remaining inputs', async t => {
    const f = await layerFixture(t)
    const { id } = await f.holdFirstPrepare()
    const active = f.state.refreshView()
    f.layer.remove(f.camera as never, undefined as never)
    f.worker.releaseDone()
    await active
    assert.equal(f.worker.sent.filter(message => message.id === id).length, 1)
    assert.equal(f.worker.terminated, true)
    assert.equal(f.state._prepared.size, 0)
    assert.equal(f.state._view.chunks.length, 0)
    assert.equal(f.state._viewPromise, undefined)
    assert.equal(f.state._pendingView, false)
    assert.equal(f.layer.isReady, false)
    await writeFile(resolve(output, 'layer-prepare-remove.json'), JSON.stringify({ obsoleteSent: f.worker.sent.filter(message => message.id === id).length,
        finalReady: f.layer.isReady, ...trace(f.worker) }, null, 2) + '\n')
})

test('replacing a source during a prepare ACK isolates the new worker and complete view', async t => {
    const f = await layerFixture(t, true)
    const { id } = await f.holdFirstPrepare()
    const previous = f.state.refreshView()
    f.index.upsert({ ...f.cells[0], elevation: 902 })
    const replaced = f.layer.setReadOnlySource(f.source('layer-replacement'))
    f.worker.releaseDone()
    await Promise.all([previous, replaced])
    await until(() => f.layer.isReady)
    const nextWorker = (f.state._geometry as unknown as { worker: ProductionWorker }).worker
    assert.notEqual(nextWorker, f.worker)
    assert.equal(f.worker.terminated, true)
    assert.equal(f.worker.sent.filter(message => message.id === id).length, 1)
    assert.ok(nextWorker.sent[0].config)
    f.assertComplete(902)
    await writeFile(resolve(output, 'layer-prepare-replace.json'), JSON.stringify({ obsoleteSent: f.worker.sent.filter(message => message.id === id).length, finalReady: f.layer.isReady,
        old: trace(f.worker), current: trace(nextWorker) }, null, 2) + '\n')
})
