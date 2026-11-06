import type { Map as MapboxMap } from 'mapbox-gl'
import PatchCore from '@/core/grid/patchCore'
import { boundingBox2D } from '@/core/util/boundingBox2D'
import { ResourceNode } from '@/template/scene/scene'
import { linkNode, unlinkNode } from '@/template/api/node'
import { getPatchMeta } from '@/template/api/patch'
import type { PatchMeta } from '@/template/api/types'
import { layerOrderCoordinator } from '@/views/mapView/layerOrderCoordinator'
import { ensureTopologyLayerInitialized, getOrCreatePerPatchTopology, removePerPatchTopology } from '@/views/mapView/topology/topologyLayerManager'
import { waitForDisplayMap } from './mapReady'
import { displayBoundsOn4326 } from './displayBounds'
import { gridDisplayI18n } from '@/i18n/gridDisplay'

async function releasePatchLock(nodeInfo: string, lockId: string) {
    const response = await unlinkNode(nodeInfo, lockId)
    if (!response.success) throw new Error(gridDisplayI18n.t('patchUnlockError', { message: response.message }))
}

async function acquirePatchLock(node: ResourceNode, access: 'r' | 'w', signal: AbortSignal) {
    signal.throwIfAborted()
    // Patch menus may have linked already, but ResourceNode does not record that
    // lock's access. Replace an unknown lock instead of assuming it permits edits.
    const previousLock = node.lockId
    if (previousLock) {
        node.lockId = null
        try {
            await releasePatchLock(node.nodeInfo, previousLock)
        } catch (error) {
            node.lockId ??= previousLock
            throw error
        }
        signal.throwIfAborted()
    }
    const response = await linkNode('gridmen/IPatch/1.0.0', node.nodeInfo, access)
    if (signal.aborted || node.lockId) {
        await releasePatchLock(node.nodeInfo, response.lock_id)
        signal.throwIfAborted()
        throw new Error(gridDisplayI18n.t('patchLockChanged'))
    }
    node.lockId = response.lock_id
    return response.lock_id
}

async function createPatchDisplay(node: ResourceNode, map: MapboxMap, access: 'r' | 'w', signal: AbortSignal) {
    const lockId = await acquirePatchLock(node, access, signal)
    const patch: PatchMeta = node.mountParams ?? await getPatchMeta(node.nodeInfo, lockId)
    signal.throwIfAborted()
    node.mountParams = patch
    const boundsOn4326 = await displayBoundsOn4326(patch.bounds, patch.epsg)
    signal.throwIfAborted()
    await waitForDisplayMap(map, signal)
    const { clgId, topologyLayer } = getOrCreatePerPatchTopology(map, node.nodeInfo, `TopologyLayer:${node.nodeInfo}`)
    await ensureTopologyLayerInitialized(topologyLayer)
    signal.throwIfAborted()
    const patchCore = new PatchCore({
        nodeInfo: node.nodeInfo,
        lockId,
        srcCS: `EPSG:${patch.epsg}`,
        targetCS: 'EPSG:4326',
        bBox: boundingBox2D(...patch.bounds as [number, number, number, number]),
        rules: patch.subdivide_rules,
    })
    topologyLayer.patchCore = patchCore
    layerOrderCoordinator.register(node.nodeInfo, [clgId])
    return { patch, patchCore, topologyLayer, boundsOn4326, clgId, lockId }
}

type PatchDisplay = Awaited<ReturnType<typeof createPatchDisplay>>
interface PatchSession {
    map: MapboxMap
    access: 'r' | 'w'
    lockId: string | null
    promise: Promise<PatchDisplay>
    dispose: () => void
}
const sessions = new WeakMap<ResourceNode, PatchSession>()

export function getPatchDisplay(node: ResourceNode, map: MapboxMap, access: 'r' | 'w'): Promise<PatchDisplay> {
    const existing = sessions.get(node)
    if (existing?.map === map && (access === 'r' || existing.access === 'w') &&
        (existing.lockId === null || existing.lockId === node.lockId)) return existing.promise
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
    // Register before awaiting: closing a node must also cancel a pending load.
    node.context = {
        ...node.context,
        __cleanup: { ...node.context?.__cleanup, topology: dispose },
    }
    let lockId: string | null = null
    const promise = (async () => {
        // An upgrade must wait for an interrupted read acquisition to release
        // its late lock before attempting to acquire write access.
        if (existing) {
            try {
                await existing.promise
            } catch (error) {
                if (!(error instanceof Error && error.name === 'AbortError')) throw error
            }
        }
        const display = await createPatchDisplay(node, map, access, controller.signal)
        lockId = display.lockId
        return display
    })().catch(error => {
        dispose()
        throw error
    })
    sessions.set(node, { map, access, get lockId() { return lockId }, promise, dispose })
    return promise
}
