import assert from 'node:assert/strict'
import test from 'node:test'
import TopologyLayer from '../src/views/mapView/topology/TopologyLayer'
import { displayLayers } from '../src/core/grid/displayHierarchy'
import type { DisplayBlock, GridDisplayView, ReadOnlyGridSource } from '../src/core/grid/displayTypes'

const tick = () => new Promise<void>(resolve => setImmediate(resolve))
const view: GridDisplayView = { cellCount: 1, chunks: [{
    key: 'original', bounds: [0, 0, 1, 1], fields: [],
    cells: [{ id: 1, bounds: [0, 0, 1, 1], level: 0, elevation: 0, landClass: 0 }],
}] }

class Camera {
    center = 0
    moving = false
    canvas = Object.assign(new EventTarget(), { width: 100, height: 100, clientWidth: 100, clientHeight: 100 })
    listeners = new Map<string, Set<() => void>>()
    container = { appendChild() {}, getBoundingClientRect: () => ({ width: 100, height: 100 }) }
    getCanvas() { return this.canvas }
    getContainer() { return this.container }
    triggerRepaint() {}
    isMoving() { return this.moving }
    unproject([x, y]: [number, number]) { return { lng: (x + this.center) * 0.01, lat: -y * 0.01 } }
    project([lng, lat]: [number, number]) { return { x: lng / 0.01 - this.center, y: -lat / 0.01 } }
    on(event: string, fn: () => void) {
        const listeners = this.listeners.get(event) ?? new Set()
        listeners.add(fn)
        this.listeners.set(event, listeners)
    }
    off(event: string, fn: () => void) { this.listeners.get(event)?.delete(fn) }
    emit(event: string) { this.listeners.get(event)?.forEach(fn => fn()) }
}

function fixture(t: { after(fn: () => void): void }) {
    const overlay = { style: {}, width: 0, height: 0, getContext: () => null, remove() {} }
    const indicator = { style: {}, textContent: '', hidden: false, setAttribute() {}, remove() {} }
    const globals = {
        document: { createElement: (tag: string) => tag === 'canvas' ? overlay : indicator }, window: new EventTarget(),
        ResizeObserver: class { observe() {} disconnect() {} },
    }
    const originals = Object.getOwnPropertyDescriptors(globalThis)
    for (const [key, value] of Object.entries(globals)) {
        Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
    }
    const camera = new Camera()
    const layer = new TopologyLayer(camera as never)
    layer.initDOM()
    layer.initialized = true
    const calls: { blocks: DisplayBlock[]; center: number; signal: AbortSignal; resolve: (data: GridDisplayView) => void }[] = []
    let active = 0, maxActive = 0
    const source: ReadOnlyGridSource = {
        meta: { revision: 'scheduling-fixture', displayLayers: displayLayers([-10, -10, 10, 10], [[1, 1]], [0, 0]),
            epsg: 4326, bounds: [-10, -10, 10, 10], grid_info: [[1, 1]],
            alignment_origin: [0, 0], level_info: [{ width: 20, height: 20 }], subdivide_rules: [],
            cellCount: 1, attributes: ['level'], elevationRange: [0, 0], landClasses: [0] },
        loadBlocks(blocks, signal) {
            active++
            maxActive = Math.max(active, maxActive)
            return new Promise<GridDisplayView>(resolve => calls.push({ blocks, center: camera.center, signal, resolve }))
                .finally(() => { active-- })
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
    return { camera, layer, calls, start, ready, maxActive: () => maxActive }
}

test('camera movement keeps visible data and requests only the final camera', async t => {
    const f = fixture(t)
    await f.ready()
    f.camera.moving = true
    for (let i = 1; i <= 120; i++) {
        f.camera.center = i
        f.camera.emit('move')
        f.camera.emit('resize')
        await tick()
    }
    assert.equal(f.calls.length, 1, 'animation must not issue or abort per-frame network queries')
    assert.equal(f.calls[0].signal.aborted, false)
    assert.equal(f.layer.isReady, true, 'cached data remains usable during motion')
    f.camera.moving = false
    f.camera.emit('moveend')
    await tick()
    assert.equal(f.calls.length, 2)
    assert.equal(f.calls[1].center, 120)
    f.calls[1].resolve(view)
    await tick()
    assert.equal(f.layer.isReady, true)
    assert.equal(f.maxActive(), 1)
    f.camera.emit('moveend')
    f.camera.emit('resize')
    await tick()
    assert.equal(f.calls.length, 2, 'an unchanged camera must be deduplicated')
})

test('one in-flight query coalesces camera bursts and reaches final ready', async t => {
    const f = fixture(t)
    const started = f.start()
    await tick()
    for (let i = 1; i <= 120; i++) {
        f.camera.center = i
        f.camera.emit('moveend')
        f.camera.emit('resize')
        await tick()
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
        await tick()
    }
    assert.equal(f.calls.length, 2)
    assert.equal(f.calls[1].signal.aborted, false)
    f.calls[1].resolve(view)
    await tick()
    assert.equal(f.calls.length, 3)
    assert.equal(f.calls[2].center, 240)
    f.calls[2].resolve(view)
    await started
    assert.equal(f.layer.isReady, true)
    assert.equal(f.maxActive(), 1)
    assert.ok(f.calls.every(call => !call.signal.aborted))
})

test('edit invalidation refreshes immediately during motion at the same camera', async t => {
    const f = fixture(t)
    await f.ready()
    f.camera.moving = true
    f.layer.updateGPUCell()
    await tick()
    assert.equal(f.calls.length, 2, 'an edit must bypass camera deduplication and motion deferral')
    f.calls[1].resolve(view)
    await tick()
    assert.equal(f.layer.isReady, true)
    f.camera.moving = false
    f.camera.emit('moveend')
    await tick()
    assert.equal(f.calls.length, 2)
})

test('hide cancels the active lifecycle and queued cameras cannot restart it', async t => {
    const f = fixture(t)
    const started = f.start()
    await tick()
    f.camera.center = 1
    f.camera.emit('moveend')
    f.layer.hide()
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
    f.calls[0].resolve({ cellCount: -1, chunks: [] }) // Must never reach source validation.
    await old
    assert.equal(f.layer.isReady, false)
    f.calls[1].resolve(view)
    await current
    assert.equal(f.layer.isReady, true)
    f.camera.emit('moveend')
    await tick()
    assert.equal(f.calls.length, 2)
})
