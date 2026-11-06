import proj4 from 'proj4'
import * as apis from '@/template/api/apis'
import Dispatcher from '../message/dispatcher'
import BoundingBox2D from '../util/boundingBox2D'
import { MercatorCoordinate } from '../math/mercatorCoordinate'
import { PatchContext, CellCheckInfo, PatchSaveInfo, MultiCellBaseInfo, CellKeyHashTable } from './types'

const DELETED_FLAG = 1
const UNDELETED_FLAG = 0

interface PatchLevelInfo {
    width: number
    height: number
}

export interface PatchCoreOptions {
    workerCount?: number
    dispatcher?: Dispatcher
}

export interface PatchCellChange {
    removed: number[]
    upserted: number[]
    reset?: boolean
}

type PatchCellRenderInfo = [number, Uint8Array, Float32Array, Float32Array, Uint8Array]
type PatchCellRenderCallback = (info: PatchCellRenderInfo) => void

export default class PatchCore {
    // Patch metadata
    nodeInfo: string
    levelInfos: PatchLevelInfo[]
    renderRelativeCenter: Float32Array = new Float32Array([0.0, 0.0])

    // Private patch memory cache
    private _lockId: string
    private _nextStorageId = 0
    private _cells = new Map<number, { level: number; globalId: number; deleted: number }>()
    private _key_storageId_dict: CellKeyHashTable
    private _changeListeners = new Set<(change: PatchCellChange) => void>()

    // Worker dispatcher
    private _dispatcher: Dispatcher

    constructor(public context: PatchContext, options: PatchCoreOptions = {}) {
        // Init metadata
        this._lockId = context.lockId
        this.nodeInfo = context.nodeInfo
        this.levelInfos = new Array<PatchLevelInfo>(this.context.rules.length)
        this.context.rules.forEach((_, level, rules) => {
            let width: number, height: number
            if (level == 0) {
                width = 1
                height = 1
            } else {
                width = this.levelInfos[level - 1].width * rules[level - 1][0]
                height = this.levelInfos[level - 1].height * rules[level - 1][1]
            }
            this.levelInfos[level] = { width, height }
        })

        // Init dispatcher
        this._dispatcher = options.dispatcher ?? new Dispatcher(this, options.workerCount)

        // Init patch cache
        this._key_storageId_dict = new CellKeyHashTable()
    }

    get bBox(): BoundingBox2D {
        return this.context.bBox
    }

    get srcCRS(): string {
        return this.context.srcCS
    }

    get targetCRS(): string {
        return this.context.targetCS
    }

    get cellNum(): number {
        return this._nextStorageId
    }

    get maxLevel(): number {
        return this.levelInfos.length - 1
    }

    getStorageId(level: number, globalId: number): number | undefined {
        return this._key_storageId_dict.get(level, globalId)
    }

    addChangeListener(listener: (change: PatchCellChange) => void): () => void {
        this._changeListeners.add(listener)
        return () => this._changeListeners.delete(listener)
    }

    private emitChange(change: PatchCellChange): void {
        for (const listener of this._changeListeners) listener(change)
    }

    private sendWorkerApiTask<T>(type: string, data: unknown, callback?: (error: Error | null | undefined, result: T) => void): void {
        this._dispatcher.syncApiBaseUrl(() => {
            this._dispatcher.actor.send(type, data, callback)
        })
    }

    init(callback?: PatchCellRenderCallback): void {
        // Get src EPSG code (number type)
        const srcEPSG: number = parseInt(this.srcCRS.split(':')[1])

        // Update proj4 definitions
        apis.proj.getProj4Defs(srcEPSG).then((proj4Defs) => {
            proj4.defs(this.srcCRS, proj4Defs)

            // Calculate bounding box center in mercator coordinates for anti-jitter rendering
            const bBoxCenter: [number, number] = proj4(this.srcCRS, this.targetCRS, this.bBox.center)
            const mercatorCenter = MercatorCoordinate.fromLonLat(bBoxCenter)
            const centerX = encodeFloatToDouble(mercatorCenter[0])
            const centerY = encodeFloatToDouble(mercatorCenter[1])
            this.renderRelativeCenter = new Float32Array([...centerX, ...centerY])

            // Clear old cells before loading the current patch.
            this._nextStorageId = 0
            this._cells.clear()
            this._key_storageId_dict = new CellKeyHashTable()
            this.emitChange({ removed: [], upserted: [], reset: true })

            this.sendWorkerApiTask('getPatchInfo', { nodeInfo: this.nodeInfo, lockId: this._lockId }, (_, baseInfo: MultiCellBaseInfo) => {
                this.updateMultiCellRenderInfo(baseInfo, callback)
            })
        })
    }

    updateMultiCellRenderInfo(baseInfo: MultiCellBaseInfo, callback?: PatchCellRenderCallback): void {
        const cellNum = baseInfo.levels.length
        if (baseInfo.globalIds.length !== cellNum || (baseInfo.deleted && baseInfo.deleted.length !== cellNum)) {
            throw new Error('Patch cell arrays have inconsistent lengths')
        }
        const start = this._nextStorageId
        for (let i = 0; i < cellNum; i++) {
            const storageId = start + i
            this._cells.set(storageId, { level: baseInfo.levels[i], globalId: baseInfo.globalIds[i], deleted: baseInfo.deleted?.[i] ?? UNDELETED_FLAG })
            this._key_storageId_dict.update(storageId, baseInfo.levels[i], baseInfo.globalIds[i])
        }
        this._nextStorageId += cellNum
        if (cellNum > 0) this.emitChange({ removed: [], upserted: Array.from({ length: cellNum }, (_, i) => start + i) })
        callback?.([start, baseInfo.levels, new Float32Array(0), new Float32Array(0), baseInfo.deleted ?? new Uint8Array(cellNum)])
    }

    deleteCellLocally(storageId: number, callback?: (info: [number, number]) => void): void {
        const lastStorageId = this._nextStorageId - 1
        this.deleteCellsLocally([storageId], ([sources, targets]: [number[], number[]]) => {
            callback?.([sources[0] ?? lastStorageId, targets[0] ?? storageId])
        })
    }

    deleteCellsLocally(storageIds: number[], callback?: (info: [number[], number[]]) => void): void {
        const sorted = [...new Set(storageIds)].sort((a, b) => a - b)
        for (const id of sorted) {
            if (!Number.isInteger(id) || id < 0 || id >= this._nextStorageId) throw new RangeError(`Invalid storage ID: ${id}`)
        }
        if (sorted.length === 0) {
            callback?.([[], []])
            return
        }

        const removedSet = new Set(sorted)
        const nextCount = this._nextStorageId - sorted.length
        for (const id of sorted) { const cell = this._cells.get(id)!; this._key_storageId_dict.delete(cell.level, cell.globalId) }

        const sources: number[] = []
        const targets: number[] = []
        let source = this._nextStorageId - 1
        for (const target of sorted) {
            if (target >= nextCount) break
            while (removedSet.has(source)) source--
            const cell = this._cells.get(source)!
            const { level, globalId } = cell
            this._cells.set(target, cell)
            this._key_storageId_dict.update(target, level, globalId)
            sources.push(source)
            targets.push(target)
            source--
        }

        for (let id = nextCount; id < this._nextStorageId; id++) this._cells.delete(id)
        this._nextStorageId = nextCount
        this.emitChange({ removed: [...new Set([...sorted, ...sources])], upserted: targets })
        callback?.([sources, targets])
    }

    /**
     * Mark the specified cells as deleted
     * @description: Marks the specified cells as deleted in the patch system.  
     * Not really deleted, but marked as deleted.  
     * For restore operation, the deleted cells must still can be picked up.
     */
    markCellsAsDeleted(removableStorageIds: number[], callback?: () => void): void {
        const levels = new Uint8Array(removableStorageIds.length)
        const globalIds = new Uint32Array(removableStorageIds.length)
        for (let i = 0; i < removableStorageIds.length; i++) {
            const storageId = removableStorageIds[i]
            const [level, globalId] = this.getInfoByStorageId(storageId)
            levels[i] = level
            globalIds[i] = globalId
            this._cells.get(storageId)!.deleted = DELETED_FLAG
        }
        if (removableStorageIds.length > 0) this.emitChange({ removed: [], upserted: [...removableStorageIds] })
        // Mark provided cells as deleted
        this.sendWorkerApiTask('deleteCells', { levels, globalIds, nodeInfo: this.nodeInfo, lockId: this._lockId }, () => {
            callback?.()
        })
    }

    restoreCells(restorableStorageIds: number[], callback?: () => void): void {
        const levels = new Uint8Array(restorableStorageIds.length)
        const globalIds = new Uint32Array(restorableStorageIds.length)
        for (let i = 0; i < restorableStorageIds.length; i++) {
            const storageId = restorableStorageIds[i]
            const [level, globalId] = this.getInfoByStorageId(storageId)
            levels[i] = level
            globalIds[i] = globalId
            this._cells.get(storageId)!.deleted = UNDELETED_FLAG
        }
        if (restorableStorageIds.length > 0) this.emitChange({ removed: [], upserted: [...restorableStorageIds] })
        // Recover provided cells
        this.sendWorkerApiTask('restoreCells', { levels, globalIds, nodeInfo: this.nodeInfo, lockId: this._lockId }, () => {
            callback?.()
        })
    }

    /**
     * Subdivide the cells by subdivideInfos  
     * Reason for use subdivideInfos instead of storageIds:  
     * Info stored in cache (indexed by storageIds) of the subdividable cells is replaced because of the previous delete operation,
     * use storageIds to get info of subdividable cells is incorrect.
     */
    subdivideCells(subdivideInfos: { levels: Uint8Array, globalIds: Uint32Array }, callback?: PatchCellRenderCallback): void {
        // Dispatch a worker to subdivide the cells
        this.sendWorkerApiTask('subdivideCells', { ...subdivideInfos, nodeInfo: this.nodeInfo, lockId: this._lockId }, (_, baseInfo: MultiCellBaseInfo) => {
            baseInfo.deleted = new Uint8Array(baseInfo.levels.length).fill(UNDELETED_FLAG)
            this.updateMultiCellRenderInfo(baseInfo, callback)
        })
    }

    mergeCells(mergeableStorageIds: number[], callback?: (info: { childStorageIds: number[]; parentInfo: MultiCellBaseInfo }) => void): void {
        const levels = new Uint8Array(mergeableStorageIds.length)
        const globalIds = new Uint32Array(mergeableStorageIds.length)
        for (let i = 0; i < mergeableStorageIds.length; i++) {
            const storageId = mergeableStorageIds[i]
            const [level, globalId] = this.getInfoByStorageId(storageId)
            levels[i] = level
            globalIds[i] = globalId
        }
        // Merge provided cells
        this.sendWorkerApiTask('mergeCells', { levels, globalIds, nodeInfo: this.nodeInfo, lockId: this._lockId }, (_, parentInfo: MultiCellBaseInfo) => {
            // Get storageIds of all child cells
            const childStorageIds: number[] = []
            const parentNum = parentInfo.levels.length
            for (let i = 0; i < parentNum; i++) {
                const parentLevel = parentInfo.levels[i]
                const parentGlobalId = parentInfo.globalIds[i]
                const children = this.getChildren(parentLevel, parentGlobalId)
                if (children) {
                    children.forEach((childGlobalId) => {
                        const childStorageId = this._key_storageId_dict.get(parentLevel + 1, childGlobalId)! // ! ensured by backend
                        childStorageIds.push(childStorageId)
                    })
                }
            }
            callback?.({ childStorageIds, parentInfo })
        })
    }

    getCellInfoByFeature(path: string, callback?: (storageIds: number[]) => void) {
        this.sendWorkerApiTask('getCellInfoByFeature', { path, nodeInfo: this.nodeInfo, lockId: this._lockId }, (_, cellInfos: { levels: Uint8Array, globalIds: Uint32Array }) => {
            const { levels, globalIds } = cellInfos
            const cellNum = levels.length
            const storageIds: number[] = new Array(cellNum)
            for (let i = 0; i < cellNum; i++) {
                const id = this._key_storageId_dict.get(levels[i], globalIds[i])! // ! ensured because all activated cells are stored in the cache
                storageIds[i] = id
            }
            callback?.(storageIds)
        })
    }

    getCellInfoByVectorNode(vectorNodeInfo: string, vectorNodeLockId: string | null, callback?: (storageIds: number[]) => void) {
        this.sendWorkerApiTask('getCellInfoByVectorNode', { nodeInfo: this.nodeInfo, lockId: this._lockId, vectorNodeInfo, vectorNodeLockId }, (_, cellInfos: { levels: Uint8Array, globalIds: Uint32Array }) => {
            const { levels, globalIds } = cellInfos
            const cellNum = levels.length
            const storageIds: number[] = new Array(cellNum)
            for (let i = 0; i < cellNum; i++) {
                const id = this._key_storageId_dict.get(levels[i], globalIds[i])! // ! ensured because all activated cells are stored in the cache
                storageIds[i] = id
            }
            callback?.(storageIds)
        })
    }

    getChildren(level: number, globalId: number): number[] | null {
        if (!Number.isInteger(level) || level < 0 || level >= this.maxLevel) return null

        const { width: levelWidth } = this.levelInfos[level]
        const globalU = globalId % levelWidth
        const globalV = Math.floor(globalId / levelWidth)

        const [subWidth, subHeight] = this.context.rules[level]
        const subCount = subWidth * subHeight

        const children = new Array<number>(subCount)
        const baseGlobalWidth = levelWidth * subWidth
        for (let localId = 0; localId < subCount; localId++) {
            const subU = localId % subWidth
            const subV = Math.floor(localId / subWidth)

            const subGlobalU = globalU * subWidth + subU
            const subGlobalV = globalV * subHeight + subV
            const subGlobalId = subGlobalV * baseGlobalWidth + subGlobalU
            children[localId] = subGlobalId
        }

        return children
    }

    getInfoByStorageId(storageId: number): [level: number, globalId: number] {
        const cell = this._cells.get(storageId)
        if (!cell) throw new RangeError(`Invalid storage ID: ${storageId}`)
        return [cell.level, cell.globalId]
    }

    isDeleted(storageId: number): boolean {
        return this._cells.get(storageId)?.deleted === DELETED_FLAG
    }

    getLocalId(level: number, globalId: number) {
        if (level === 0) return 0

        const { width } = this.levelInfos[level]
        const [subWidth, subHeight] = this.context.rules[level - 1]

        const u = globalId % width
        const v = Math.floor(globalId / width)

        return ((v % subHeight) * subWidth) + (u % subWidth)
    }

    check(storageId: number): CellCheckInfo {
        const [level, globalId] = this.getInfoByStorageId(storageId)
        const localId = this.getLocalId(level, globalId)
        const deleted = this.isDeleted(storageId)

        return {
            storageId,
            level,
            globalId,
            localId,
            deleted
        }
    }

    save(callback: (info: PatchSaveInfo) => void) {
        this.sendWorkerApiTask('savePatch', { nodeInfo: this.nodeInfo, lockId: this._lockId }, (_, patchInfo: PatchSaveInfo) => {
            callback?.(patchInfo)
        })
    }

    remove() {
        this._dispatcher.remove()
    }
}

// Helpers //////////////////////////////////////////////////////////////////////////////////////////////////////

function encodeFloatToDouble(value: number) {
    const result = new Float32Array(2)
    result[0] = value
    const delta = value - result[0]
    result[1] = delta
    return result
}
