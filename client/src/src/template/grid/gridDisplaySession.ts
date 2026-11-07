import type { Map as MapboxMap } from 'mapbox-gl'
import type { ReadOnlyGridSource } from '@/core/grid/displayTypes'
import type TopologyLayer from '@/views/mapView/topology/TopologyLayer'
import { ResourceNode } from '../scene/scene'
import { createGridDisplayBlockCache, getGridDisplayMeta, GridDisplayHttpError, inspectGrid } from '../api/grid'
import { displayBoundsOn4326 } from '@/components/gridDisplay/displayBounds'
import { waitForDisplayMap } from '@/components/gridDisplay/mapReady'
import { layerOrderCoordinator } from '@/views/mapView/layerOrderCoordinator'
import { ensureTopologyLayerInitialized, getOrCreatePerPatchTopology, removePerPatchTopology } from '@/views/mapView/topology/topologyLayerManager'

async function createGridDisplay(node: ResourceNode, map: MapboxMap, signal: AbortSignal, observe: (layer: TopologyLayer) => void) {
    const meta = await getGridDisplayMeta(node.nodeInfo, signal)
    const boundsOn4326 = await displayBoundsOn4326(meta.bounds, meta.epsg)
    signal.throwIfAborted()
    await waitForDisplayMap(map, signal)
    const { clgId, topologyLayer } = getOrCreatePerPatchTopology(map, node.nodeInfo, `TopologyLayer:${node.nodeInfo}`)
    await ensureTopologyLayerInitialized(topologyLayer)
    signal.throwIfAborted()
    observe(topologyLayer)
    const cache = createGridDisplayBlockCache(node.nodeInfo, meta)
    const source: ReadOnlyGridSource = {
        meta, cache,
        loadBlocks: (blocks, requestSignal, decode) => cache.query(blocks, AbortSignal.any([signal, requestSignal]), decode),
        inspect: (x, y) => inspectGrid(node.nodeInfo, x, y, signal),
    }
    await topologyLayer.setReadOnlySource(source)
    signal.throwIfAborted()
    layerOrderCoordinator.register(node.nodeInfo, [clgId])
    return { meta, topologyLayer, boundsOn4326 }
}

type Display = Awaited<ReturnType<typeof createGridDisplay>>
interface GridSession {
    map: MapboxMap
    promise: Promise<Display>
    listeners: Set<() => void>
    dispose: () => void
}

const sessions = new WeakMap<ResourceNode, GridSession>()
const revisionChanged = (error: unknown) => error instanceof GridDisplayHttpError && error.status === 409

export function getGridDisplay(node: ResourceNode, map: MapboxMap): GridSession {
    const existing = sessions.get(node)
    if (existing?.map === map) return existing
    existing?.dispose()
    let disposed = false
    let active: AbortController | undefined
    let refreshing: Promise<Display> | undefined
    let observed: TopologyLayer | undefined
    let unsubscribe: (() => void) | undefined
    const dispose = () => {
        if (disposed) return
        disposed = true
        active?.abort()
        unsubscribe?.()
        removePerPatchTopology(map, node.nodeInfo)
        layerOrderCoordinator.unregister(node.nodeInfo)
        if (sessions.get(node) === session) sessions.delete(node)
    }
    const observe = (layer: TopologyLayer) => {
        if (observed === layer) return
        unsubscribe?.()
        observed = layer
        unsubscribe = layer.addErrorListener(error => {
            if (disposed || refreshing || !revisionChanged(error)) return
            session.promise = refresh()
            for (const listener of session.listeners) listener()
        })
    }
    const refresh = (): Promise<Display> => {
        if (refreshing) return refreshing
        active?.abort()
        const run = async () => {
            for (;;) {
                if (disposed) throw new DOMException('Grid display disposed', 'AbortError')
                const controller = new AbortController()
                active = controller
                try { return await createGridDisplay(node, map, controller.signal, observe) }
                catch (error) {
                    controller.abort()
                    if (disposed || !revisionChanged(error)) throw error
                    // The next metadata response owns a fresh source and worker.
                    // Revision churn is serialized, with no retry-count policy.
                }
            }
        }
        const promise = Promise.resolve().then(run).finally(() => { if (refreshing === promise) refreshing = undefined })
        refreshing = promise
        return promise
    }
    const session: GridSession = { map, listeners: new Set(), dispose, promise: refresh() }
    node.context = { ...node.context, __cleanup: { ...node.context?.__cleanup, topology: dispose } }
    sessions.set(node, session)
    return session
}
