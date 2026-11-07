import assert from 'node:assert/strict'
import test from 'node:test'
import TopologyLayer from '../src/views/mapView/topology/TopologyLayer'
import { DisplayViewCache } from '../src/core/grid/displayBlockCache'
import { blockKey, displayLayers } from '../src/core/grid/displayHierarchy'
import type { DisplayBlock, DisplayBlockDecoder, GridDisplayView, ReadOnlyGridSource } from '../src/core/grid/displayTypes'
import { DisplayGeometryClient } from '../src/core/worker/displayGeometryClient'
import { GeometryWorker } from './displayGeometryWorker'
import { MercatorCoordinate } from '../src/core/math/mercatorCoordinate'

const tick = () => new Promise<void>(resolve => setImmediate(resolve))
const view: GridDisplayView = { chunks: [{
    key: 'original', bounds: [0, 0, 1, 1], fields: [],
    cells: [{ id: 1, bounds: [0, 0, 1, 1], level: 0, elevation: 0, landClass: 0 }],
}] }

class Camera {
    center = 0
    zoom = 10
    moving = false
    canvas = Object.assign(new EventTarget(), { width: 100, height: 100, clientWidth: 100, clientHeight: 100 })
    listeners = new Map<string, Set<() => void>>()
    container = { appendChild() {}, getBoundingClientRect: () => ({ width: 100, height: 100 }) }
    getCanvas() { return this.canvas }
    getContainer() { return this.container }
    triggerRepaint() {}
    isMoving() { return this.moving }
    getProjection() { return { name: 'mercator' } }
    getPitch() { return 0 }
    getBearing() { return 0 }
    getZoom() { return this.zoom }
    unproject([x, y]: [number, number]) { const scale = 2 ** (this.zoom - 10); return { lng: (x / scale + this.center) * 0.01, lat: MercatorCoordinate.latFromMercatorY(0.5 + y / scale / 36000) } }
    project([lng, lat]: [number, number]) { const scale = 2 ** (this.zoom - 10); return { x: (lng / 0.01 - this.center) * scale, y: (MercatorCoordinate.mercatorYfromLat(lat) - 0.5) * 36000 * scale } }
    on(event: string, fn: () => void) {
        const listeners = this.listeners.get(event) ?? new Set()
        listeners.add(fn)
        this.listeners.set(event, listeners)
    }
    off(event: string, fn: () => void) { this.listeners.get(event)?.delete(fn) }
    emit(event: string) { this.listeners.get(event)?.forEach(fn => fn()) }
}

function fixture(t: { after(fn: () => void): void }) {
    let nextFrame = 0
    const frames = new Map<number, FrameRequestCallback>()
    const overlay = { style: {}, width: 0, height: 0, getContext: () => null, remove() {} }
    const indicator = { style: {}, textContent: '', hidden: false, setAttribute() {}, remove() {} }
    const globals = {
        document: { createElement: (tag: string) => tag === 'canvas' ? overlay : indicator }, window: new EventTarget(),
        ResizeObserver: class { observe() {} disconnect() {} },
        Worker: GeometryWorker,
        requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame },
        cancelAnimationFrame: (id: number) => { frames.delete(id) },
    }
    const originals = Object.getOwnPropertyDescriptors(globalThis)
    for (const [key, value] of Object.entries(globals)) {
        Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
    }
    const camera = new Camera()
    const layer = new TopologyLayer(camera as never)
    layer.initDOM()
    layer.initialized = true
    const calls: { blocks: DisplayBlock[]; center: number; signal: AbortSignal; resolve: (data: GridDisplayView) => void; reject: (error: unknown) => void; decode?: DisplayBlockDecoder }[] = []
    let active = 0, maxActive = 0
    const cache = new DisplayViewCache()
    const source: ReadOnlyGridSource = {
        cache,
        meta: { revision: 'scheduling-fixture', displayLayers: displayLayers([-10, -10, 10, 10], [[1, 1]], [0, 0]),
            epsg: 4326, bounds: [-10, -10, 10, 10], grid_info: [[1, 1]],
            alignment_origin: [0, 0], elevationRange: [0, 0], landClasses: [0] },
        loadBlocks(blocks, signal, decode) {
            active++
            maxActive = Math.max(active, maxActive)
            return new Promise<GridDisplayView>((resolve, reject) => calls.push({ blocks, center: camera.center, signal, resolve, reject, decode }))
                .then(view => {
                    signal.throwIfAborted()
                    const keys = blocks.map(blockKey)
                    cache.begin(keys)
                    for (const key of keys) cache.setBlock(key, view.chunks)
                    return cache.view(keys)
                }).finally(() => { active-- })
        },
        inspect: async () => ({ cell: null, neighbors: [] }),
    }
    t.after(() => {
        layer.remove(camera as never, undefined as never)
        calls.forEach(call => call.resolve(view))
        for (const key of Object.keys(globals)) {
            if (originals[key]) Object.defineProperty(globalThis, key, originals[key])
            else Reflect.deleteProperty(globalThis, key)
        }
    })
    const start = () => layer.setReadOnlySource(source)
    async function ready() {
        const started = start()
        await tick()
        calls[0].resolve(view)
        await started
    }
    async function frame() {
        const callbacks = [...frames.values()]
        frames.clear()
        callbacks.forEach(callback => callback(performance.now()))
        await tick()
    }
    return { camera, layer, calls, start, ready, frame, frames, maxActive: () => maxActive }
}

test('camera frames request new visible blocks while moving and merge input bursts', async t => {
    const f = fixture(t)
    await f.ready()
    f.camera.moving = true
    for (let i = 1; i <= 120; i++) {
        f.camera.center = i
        f.camera.emit('move')
        f.camera.emit('zoom')
    }
    assert.equal(f.calls.length, 1, 'raw camera events must coalesce until the browser frame')
    assert.equal(f.frames.size, 1)
    await f.frame()
    assert.equal(f.calls.length, 2, 'a moving camera must start loading before moveend')
    assert.equal(f.calls[1].center, 120)
    assert.notDeepEqual(f.calls[1].blocks, f.calls[0].blocks, 'the request must select the new viewport geometry')
    assert.equal(f.calls[0].signal.aborted, false)
    f.calls[1].resolve(view)
    await tick()
    assert.equal(f.layer.isReady, true)
    assert.equal(f.camera.isMoving(), true, 'the new viewport must commit during motion')
    f.camera.center = 200
    f.camera.emit('move')
    await f.frame()
    assert.equal(f.calls.length, 3)
    f.camera.center = 240
    f.camera.moving = false
    f.camera.emit('moveend')
    await f.frame()
    f.calls[2].resolve(view)
    await tick()
    assert.equal(f.calls.length, 4)
    assert.equal(f.calls[3].center, 240, 'the final view must follow the active request')
    f.calls[3].resolve(view)
    await tick()
    assert.equal(f.frames.size, 0)
    assert.equal(f.layer.isReady, true)
    assert.equal(f.maxActive(), 1)
    f.camera.emit('moveend')
    f.camera.emit('resize')
    await f.frame()
    assert.equal(f.calls.length, 4, 'an unchanged camera must be deduplicated')
    await f.frame()
    assert.equal(f.frames.size, 0, 'an idle camera must not keep scheduling frames')
})

test('one in-flight query coalesces camera bursts and reaches final ready', async t => {
    const f = fixture(t)
    const started = f.start()
    await tick()
    f.camera.moving = true
    for (let i = 1; i <= 120; i++) {
        f.camera.center = i
        f.camera.emit('move')
        f.camera.emit('resize')
        await f.frame()
    }
    assert.equal(f.calls.length, 1)
    assert.equal(f.calls[0].signal.aborted, false)
    f.calls[0].resolve(view)
    await tick()
    assert.equal(f.calls.length, 2)
    assert.equal(f.calls[1].center, 120, 'only the most recent camera may follow the first query')
    assert.equal(f.layer.isReady, false)
    for (let i = 121; i <= 240; i++) {
        f.camera.center = i
        f.camera.emit('resize')
        await f.frame()
    }
    assert.equal(f.calls.length, 2)
    assert.equal(f.calls[1].signal.aborted, false)
    f.calls[1].resolve(view)
    await tick()
    assert.equal(f.calls.length, 3)
    assert.equal(f.calls[2].center, 240)
    f.calls[2].resolve(view)
    await started
    assert.equal(f.camera.isMoving(), true)
    assert.equal(f.layer.isReady, true)
    assert.equal(f.maxActive(), 1)
    assert.ok(f.calls.every(call => !call.signal.aborted))
})

test('a superseded zoom response cannot commit geometry or mark the latest view ready', async t => {
    const f = fixture(t)
    await f.ready()
    f.camera.zoom = 9
    f.camera.emit('zoom')
    await f.frame()
    assert.equal(f.calls.length, 2)
    f.camera.zoom = 11
    f.camera.emit('zoom')
    await f.frame()
    const before = Reflect.get(f.layer, '_view')
    f.calls[1].resolve({ chunks: [] })
    await tick()
    assert.equal(Reflect.get(f.layer, '_view'), before)
    assert.equal(f.calls.length, 3)
    assert.equal(f.layer.isReady, false)
    f.calls[2].resolve(view)
    await tick()
    assert.equal(f.layer.isReady, true)
    assert.equal(f.maxActive(), 1)
})

test('HTTP completed for an obsolete zoom skips decode and still drains the latest view in the same load', async t => {
    const f = fixture(t)
    await f.ready()
    f.camera.zoom = 9
    f.camera.emit('zoom')
    await f.frame()
    const old = f.calls[1]
    f.camera.zoom = 11
    f.camera.emit('zoom')
    await f.frame()
    // Invalid bytes make an accidental decoder call fail as GDN5, rather than
    // silently looking like an aborted obsolete camera.
    let aborted: unknown
    try { await old.decode!([{ block: old.blocks[0], buffer: new ArrayBuffer(1) }]) }
    catch (error) { aborted = error }
    assert.equal((aborted as Error).name, 'AbortError')
    assert.equal(old.signal.aborted, true)
    old.reject(aborted)
    await tick()
    assert.equal(f.calls.length, 3)
    assert.equal(f.layer.isReady, false)
    assert.equal(f.calls[2].signal.aborted, false)
    f.calls[2].resolve(view)
    await tick()
    assert.equal(f.layer.isReady, true)
    assert.equal(f.maxActive(), 1)
})

test('hide cancels the active lifecycle and queued cameras cannot restart it', async t => {
    const f = fixture(t)
    const started = f.start()
    await tick()
    f.camera.center = 1
    f.camera.emit('move')
    assert.equal(f.frames.size, 1)
    f.layer.hide()
    assert.equal(f.frames.size, 0, 'hide must cancel the queued camera frame')
    assert.equal(f.calls[0].signal.aborted, true)
    f.calls[0].resolve(view)
    await started
    await tick()
    assert.equal(f.calls.length, 1)
    f.layer.show()
    await tick()
    assert.equal(f.calls.length, 2)
    f.calls[1].resolve(view)
    await tick()
    assert.equal(f.layer.isReady, true)
})

test('source replacement cancels only the old lifecycle and ignores its late response', async t => {
    const f = fixture(t)
    const old = f.start()
    await tick()
    f.camera.center = 100
    f.camera.emit('resize')
    const current = f.start()
    await tick()
    assert.equal(f.calls.length, 2)
    assert.equal(f.calls[0].signal.aborted, true)
    assert.equal(f.calls[1].signal.aborted, false)
    f.calls[0].resolve({ chunks: [] }) // Must never reach source validation.
    await old
    assert.equal(f.layer.isReady, false)
    f.calls[1].resolve(view)
    await current
    assert.equal(f.layer.isReady, true)
    f.camera.emit('moveend')
    await f.frame()
    assert.equal(f.calls.length, 2)
})

test('remove cancels the active load and queued frame without restarting', async t => {
    const f = fixture(t)
    const started = f.start()
    await tick()
    f.camera.center = 100
    f.camera.emit('move')
    f.layer.remove(f.camera as never, undefined as never)
    assert.equal(f.calls[0].signal.aborted, true)
    assert.equal(f.frames.size, 0)
    f.calls[0].resolve(view)
    await started
    await f.frame()
    assert.equal(f.calls.length, 1)
    assert.equal(f.layer.isReady, false)
    assert.ok([...f.camera.listeners.values()].every(listeners => listeners.size === 0))
})

test('context loss cancels active and queued camera work and suspends new queries', async t => {
    const f = fixture(t)
    const started = f.start()
    await tick()
    f.camera.emit('move')
    f.camera.canvas.dispatchEvent(new Event('webglcontextlost'))
    assert.equal(f.calls[0].signal.aborted, true)
    assert.equal(f.frames.size, 0)
    f.calls[0].resolve(view)
    await started
    f.camera.center = 100
    f.camera.emit('move')
    f.camera.emit('resize')
    await f.frame()
    assert.equal(f.calls.length, 1)
    assert.equal(f.layer.isReady, false)
})

test('viewport errors reach the shared listener immediately and successful recovery clears them', async t => {
    const f = fixture(t)
    const errors: unknown[] = []
    const unsubscribe = f.layer.addErrorListener(error => errors.push(error))
    assert.deepEqual(errors, [null])
    const started = f.start()
    await tick()
    const error = new Error('viewport unavailable')
    f.calls[0].reject(error)
    await assert.rejects(started, /viewport unavailable/)
    assert.deepEqual(errors, [null, error])
    const late: unknown[] = []
    const stopLate = f.layer.addErrorListener(value => late.push(value))
    assert.deepEqual(late, [error])
    f.camera.emit('resize')
    await f.frame()
    assert.equal(f.calls.length, 2)
    f.calls[1].resolve(view)
    await tick()
    assert.equal(errors.at(-1), null)
    assert.equal(f.layer.isReady, true)
    unsubscribe(); stopLate()
})

test('DPR-only camera changes supersede a pending selection and enter the selection RPC', async t => {
    const run = DisplayGeometryClient.prototype.run
    const radii: number[] = []
    DisplayGeometryClient.prototype.run = function (task, continueAfterBlock) {
        if (task.type === 'select') radii.push(task.requiredRadius ?? 0.75)
        return run.call(this, task, continueAfterBlock)
    }
    t.after(() => { DisplayGeometryClient.prototype.run = run })
    const f = fixture(t)
    await f.ready()
    f.camera.zoom = 9
    f.camera.emit('zoom')
    await f.frame()
    const stale = f.calls[1]
    f.camera.canvas.width = 50
    f.camera.canvas.height = 50
    f.camera.emit('resize')
    await f.frame()
    let cancelled: unknown
    try { await stale.decode!([{ block: stale.blocks[0], buffer: new ArrayBuffer(1) }]) }
    catch (error) { cancelled = error }
    assert.equal((cancelled as Error).name, 'AbortError')
    stale.reject(cancelled)
    await tick()
    assert.equal(f.calls.length, 3)
    assert.equal(radii.at(-1), 1.5)
    f.calls[2].resolve(view)
    await tick()
    assert.equal(f.layer.isReady, true)
})
