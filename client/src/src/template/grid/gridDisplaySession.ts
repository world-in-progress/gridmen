import type { Map as MapboxMap } from 'mapbox-gl'
import type { GridDisplayMeta, ReadOnlyGridSource } from '@/core/grid/displayTypes'
import { ResourceNode } from '../scene/scene'
import { createGridDisplayBlockCache, getGridDisplayMeta, inspectGrid } from '../api/grid'
import { errorMessage } from '@/i18n/gridDisplay'
import { displayBoundsOn4326 } from '@/components/gridDisplay/displayBounds'
import { waitForDisplayMap } from '@/components/gridDisplay/mapReady'
import { layerOrderCoordinator } from '@/views/mapView/layerOrderCoordinator'
import { ensureTopologyLayerInitialized, getOrCreatePerPatchTopology, removePerPatchTopology } from '@/views/mapView/topology/topologyLayerManager'

async function createGridDisplay(node: ResourceNode, map: MapboxMap, signal: AbortSignal, reportError: (error: string | null) => void) {
    const meta: GridDisplayMeta = await getGridDisplayMeta(node.nodeInfo, signal)
    const boundsOn4326 = await displayBoundsOn4326(meta.bounds, meta.epsg)
    signal.throwIfAborted()
    await waitForDisplayMap(map, signal)
    const { clgId, topologyLayer } = getOrCreatePerPatchTopology(map, node.nodeInfo, `TopologyLayer:${node.nodeInfo}`)
    await ensureTopologyLayerInitialized(topologyLayer)
    signal.throwIfAborted()
    const cache = createGridDisplayBlockCache(node.nodeInfo, meta)
    const source: ReadOnlyGridSource = {
        meta,
        clearCache: () => cache.clear(),
        reportError: error => reportError(errorMessage(error)),
        loadBlocks: async (blocks, requestSignal, decode) => {
            const combined = AbortSignal.any([signal, requestSignal])
            try {
                const view = await cache.query(blocks, combined, decode)
                if (!combined.aborted) reportError(null)
                return view
            } catch (error) {
                if (!combined.aborted) reportError(errorMessage(error))
                throw error
            }
        },
        inspect: (x, y) => inspectGrid(node.nodeInfo, x, y, signal),
    }
    await topologyLayer.setReadOnlySource(source)
    signal.throwIfAborted()
    layerOrderCoordinator.register(node.nodeInfo, [clgId])
    return { meta, topologyLayer, boundsOn4326 }
}

interface GridSession {
    map: MapboxMap
    promise: ReturnType<typeof createGridDisplay>
    error: string | null
    listeners: Set<() => void>
    dispose: () => void
}

const sessions = new WeakMap<ResourceNode, GridSession>()

export function getGridDisplay(node: ResourceNode, map: MapboxMap): GridSession {
    const existing = sessions.get(node)
    if (existing?.map === map) return existing
    existing?.dispose()
    const controller = new AbortController()
    let disposed = false
    const dispose = () => {
        if (disposed) return
        disposed = true
        controller.abort()
        removePerPatchTopology(map, node.nodeInfo)
        layerOrderCoordinator.unregister(node.nodeInfo)
        sessions.delete(node)
    }
    node.context = {
        ...node.context,
        __cleanup: { ...node.context?.__cleanup, topology: dispose },
    }
    const session: GridSession = {
        map,
        error: null,
        listeners: new Set(),
        dispose,
        promise: createGridDisplay(node, map, controller.signal, error => {
            if (disposed || session.error === error) return
            session.error = error
            session.listeners.forEach(listener => listener())
        }).catch(error => { dispose(); throw error }),
    }
    sessions.set(node, session)
    return session
}
