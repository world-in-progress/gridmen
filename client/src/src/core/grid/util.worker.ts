import * as api from '@/template/api/apis'
import { setRuntimeApiBaseUrlOverride } from '@/utils/apiBaseUrl'
import type { Callback } from '../types'
import type { MultiCellBaseInfo, PatchSaveInfo } from './types'

const DELETED_FLAG = 1
const UNDELETED_FLAG = 0

export function setApiBaseUrlForWorker(
    apiBaseUrl: string | null,
    callback: Callback<void>
) {
    setRuntimeApiBaseUrlOverride(apiBaseUrl)
    callback()
}

export async function subdivideCells(
    gridInfo: { levels: Uint8Array, globalIds: Uint32Array, nodeInfo: string, lockId: string },
    callback: Callback<MultiCellBaseInfo>
) {
    const renderInfo = await api.patch.subdivideCells(gridInfo, gridInfo.nodeInfo, gridInfo.lockId)
    callback(null, renderInfo)
}

export async function mergeCells(
    gridInfo: { levels: Uint8Array, globalIds: Uint32Array, nodeInfo: string, lockId: string },
    callback: Callback<MultiCellBaseInfo>
) {
    const renderInfo = await api.patch.mergeCells(gridInfo, gridInfo.nodeInfo, gridInfo.lockId)
    callback(null, renderInfo)
}

export async function deleteCells(
    gridInfo: { levels: Uint8Array, globalIds: Uint32Array, nodeInfo: string, lockId: string },
    callback: Callback<void>
) {
    await api.patch.deleteCells(gridInfo, gridInfo.nodeInfo, gridInfo.lockId)
    callback()
}

export async function restoreCells(
    gridInfo: { levels: Uint8Array, globalIds: Uint32Array, nodeInfo: string, lockId: string },
    callback: Callback<void>
) {
    await api.patch.restoreCells(gridInfo, gridInfo.nodeInfo, gridInfo.lockId)
    callback()
}

export async function getCellInfoByFeature(
    pickInfo: { path: string, nodeInfo: string, lockId: string },
    callback: Callback<Pick<MultiCellBaseInfo, 'levels' | 'globalIds'>>
) {
    const result = await api.patch.pickByFeature(pickInfo.path, pickInfo.nodeInfo, pickInfo.lockId)
    callback(null, {
        levels: result.levels,
        globalIds: result.globalIds
    })
}

export async function getCellInfoByVectorNode(
    pickInfo: { nodeInfo: string, lockId: string, vectorNodeInfo: string, vectorNodeLockId: string | null },
    callback: Callback<Pick<MultiCellBaseInfo, 'levels' | 'globalIds'>>
) {
    const result = await api.patch.pickByVectorNode(
        pickInfo.nodeInfo,
        pickInfo.lockId,
        pickInfo.vectorNodeInfo,
        pickInfo.vectorNodeLockId
    )
    callback(null, {
        levels: result.levels,
        globalIds: result.globalIds
    })
}

export async function getPatchInfo(
    data: {
        nodeInfo: string
        lockId: string
    },
    callback: Callback<MultiCellBaseInfo>
) {
    const [activateInfoResponse, deletedInfoResponse] = await Promise.all([
        api.patch.activateCellInfo(data.nodeInfo, data.lockId),
        api.patch.deletedCellInfo(data.nodeInfo, data.lockId)
    ])

    // Create combined levels for activate and deleted grids
    const combinedLevels = new Uint8Array(activateInfoResponse.levels.length + deletedInfoResponse.levels.length)
    combinedLevels.set(activateInfoResponse.levels, 0)
    combinedLevels.set(deletedInfoResponse.levels, activateInfoResponse.levels.length)

    // Create combined global IDs for activate and deleted grids
    const combinedGlobalIds = new Uint32Array(activateInfoResponse.globalIds.length + deletedInfoResponse.globalIds.length)
    combinedGlobalIds.set(activateInfoResponse.globalIds, 0)
    combinedGlobalIds.set(deletedInfoResponse.globalIds, activateInfoResponse.globalIds.length)

    // Create a combined deleted flags array
    const combinedDeleted = new Uint8Array(combinedLevels.length)
    combinedDeleted.fill(UNDELETED_FLAG, 0, activateInfoResponse.levels.length)
    combinedDeleted.fill(DELETED_FLAG, activateInfoResponse.levels.length)

    const renderInfo = {
        levels: combinedLevels,
        globalIds: combinedGlobalIds,
        deleted: combinedDeleted,
    }
    callback(null, renderInfo)
}

export async function savePatch(
    data: {
        nodeInfo: string
        lockId: string
    },
    callback: Callback<PatchSaveInfo>
) {
    const result = await api.patch.savePatch(data.nodeInfo, data.lockId)
    callback(null, result)
}
