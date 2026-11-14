import TopologyLayer from '../src/views/mapView/topology/TopologyLayer'
import { DisplayViewCache } from '../src/core/grid/displayBlockCache'
import { blockKey, displayLayers } from '../src/core/grid/displayHierarchy'
import type { DisplayBlock, DisplayBlockDecoder, GridDisplayView, ReadOnlyGridSource } from '../src/core/grid/displayTypes'
import { GeometryWorker } from './displayGeometryWorker'
import { MercatorCoordinate } from '../src/core/math/mercatorCoordinate'

export const tick = () => new Promise<void>(resolve => setImmediate(resolve))
export const view: GridDisplayView = { chunks: [{
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

export function fixture(t: { after(fn: () => void): void }) {
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
    return { camera, layer, source, calls, start, ready, frame, frames, maxActive: () => maxActive }
}
