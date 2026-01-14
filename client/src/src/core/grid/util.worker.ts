import * as api from '@/template/api/apis'
import GridManager from './NHGridManager'
import { Callback, WorkerSelf } from '../types'
import { GridContext, MultiGridBaseInfo } from './types'

const DELETED_FLAG = 1
const UNDELETED_FLAG = 0

type WorkerContext = WorkerSelf & Record<'gridManager', GridManager>

export function setGridManager(
    this: WorkerContext,
    context: GridContext,
    callback: Callback<any>
) {
    this.gridManager = new GridManager(context)
    callback()
}

export async function subdivideGrids(
    this: WorkerContext,
    gridInfo: { levels: Uint8Array, globalIds: Uint32Array, node_key: string, lock_id: string },
    callback: Callback<any>
) {
    const renderInfo = await api.patch.subdivideGrids.fetch(gridInfo, gridInfo.node_key, gridInfo.lock_id)
    callback(null, renderInfo)
}

// export async function mergeGrids(
//     this: WorkerContext,
//     gridInfo: { levels: Uint8Array, globalIds: Uint32Array, isRemote: boolean },
//     callback: Callback<any>
// ) {
//     const renderInfo = await api.patch.mergeGrids.fetch(gridInfo, gridInfo.isRemote)
//     callback(null, renderInfo)
// }

// export async function deleteGrids(
//     gridInfo: { levels: Uint8Array, globalIds: Uint32Array, isRemote: boolean },
//     callback: Callback<any>
// ) {
//     await api.patch.deleteGrids.fetch(gridInfo, gridInfo.isRemote)
//     callback()
// }

// export async function recoverGrids(
//     gridInfo: { levels: Uint8Array, globalIds: Uint32Array, isRemote: boolean },
//     callback: Callback<any>
// ) {
//     await api.patch.recoverGrids.fetch(gridInfo, gridInfo.isRemote)
//     callback()
// }

// export async function getGridInfoByFeature(
//     pickInfo: { path: string, isRemote: boolean },
//     callback: Callback<any>
// ) {
//     const result = await api.patch.pickGridsByFeature.fetch(pickInfo.path, pickInfo.isRemote)
//     callback(null, {
//         levels: result.levels,
//         globalIds: result.globalIds
//     })
// }

// export async function saveGrids(isRemote: boolean, callback: Callback<any>) {
//     const result = await api.patch.saveGrids.fetch(api.VOID_VALUE, isRemote)
//     callback(null, result)
// }

export async function getMultiGridRenderVertices(
    this: WorkerSelf & Record<'gridManager', GridManager>,
    gridInfo: MultiGridBaseInfo,
    callback: Callback<any>
) {
    const result = this.gridManager.createStructuredGridRenderVertices(gridInfo.levels, gridInfo.globalIds)
    callback(null, result)
}

export async function getGridInfo(
    this: WorkerSelf & Record<'gridManager', GridManager>,
    data: {
        node_key: string
        lock_id: string
    },
    callback: Callback<any>
) {
    console.log('Worker getGridInfo', data.node_key, data.lock_id)
    const [activateInfoResponse, deletedInfoResponse] = await Promise.all([
        api.patch.activateGridInfo(data.node_key, data.lock_id),
        api.patch.deletedGridInfo(data.node_key, data.lock_id)
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
    callback(null, renderInfo);
}
