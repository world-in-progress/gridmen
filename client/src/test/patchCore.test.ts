import assert from 'node:assert/strict'
import test from 'node:test'

import PatchCore, { type PatchCellChange } from '../src/core/grid/patchCore'
import type Dispatcher from '../src/core/message/dispatcher'
import BoundingBox2D from '../src/core/util/boundingBox2D'
import type { MultiCellBaseInfo, PatchContext } from '../src/core/grid/types'

function fixture(responses: Record<string, unknown> = {}) {
    const calls: string[] = []
    const dispatcher = {
        syncApiBaseUrl(callback: () => void) { callback() },
        actor: {
            send(type: string, _data: unknown, callback?: (error: null, result: unknown) => void) {
                calls.push(type)
                callback?.(null, responses[type])
            },
        },
        remove() {},
    } as unknown as Dispatcher
    const context: PatchContext = {
        nodeInfo: 'patch', lockId: 'lock', srcCS: 'EPSG:4326', targetCS: 'EPSG:4326',
        bBox: new BoundingBox2D(0, 0, 1, 1), rules: [[2, 2], [2, 2], [2, 2]],
    }
    return { core: new PatchCore(context, { dispatcher }), calls }
}

function cells(ids: number[], level = 1, deleted?: number[]): MultiCellBaseInfo {
    return { levels: new Uint8Array(ids.map(() => level)), globalIds: new Uint32Array(ids), deleted: deleted && new Uint8Array(deleted) }
}

test('grows with loaded cells and calls back synchronously without worker vertices', () => {
    const { core, calls } = fixture()
    const changes: PatchCellChange[] = []
    const unsubscribe = core.addChangeListener(change => {
        changes.push(change)
        assert.equal(core.cellNum, change.upserted.length)
    })
    let zeroCallback = false
    core.updateMultiCellRenderInfo(cells([]), (info: [number, Uint8Array, Float32Array]) => {
        zeroCallback = true
        assert.equal(info[2].length, 0)
    })
    assert.equal(zeroCallback, true)

    const ids = Array.from({ length: 41 }, (_, i) => i)
    let callbackCount = 0
    core.updateMultiCellRenderInfo(cells(ids), ([start, levels, vertices, verticesLow]: [number, Uint8Array, Float32Array, Float32Array]) => {
        callbackCount++
        assert.equal(core.cellNum, 41)
        assert.equal(start, 0)
        assert.equal(levels.length, 41)
        assert.equal(vertices.length, 0)
        assert.equal(verticesLow.length, 0)
    })
    assert.equal(callbackCount, 1)
    assert.equal(core.getStorageId(1, 40), 40)
    const cache = core as unknown as { _cells: Map<number, unknown> }
    assert.equal(cache._cells.size, 41)
    assert.deepEqual(calls, [])
    assert.equal(changes.length, 1)
    unsubscribe()
    core.updateMultiCellRenderInfo(cells([41]))
    assert.equal(changes.length, 1)
})

test('appends after compaction and rejects invalid or duplicate deletion requests', () => {
    const { core } = fixture()
    core.updateMultiCellRenderInfo(cells([10, 11, 12, 13]))
    for (const invalid of [-1, 4, 1.5, NaN, Infinity]) {
        assert.throws(() => core.deleteCellsLocally([1, invalid]), RangeError)
        assert.equal(core.cellNum, 4)
        assert.equal(core.getStorageId(1, 11), 1)
    }
    let callbacks = 0
    core.deleteCellsLocally([1, 1, 3], ([sources, targets]: [number[], number[]]) => {
        callbacks++
        assert.deepEqual([sources, targets], [[2], [1]])
    })
    assert.equal(callbacks, 1)
    assert.equal(core.cellNum, 2)
    assert.equal(core.getStorageId(1, 12), 1)
    assert.equal(core.getStorageId(1, 11), undefined)
    core.updateMultiCellRenderInfo(cells([14, 15]))
    assert.equal(core.getStorageId(1, 14), 2)
    assert.equal(core.getStorageId(1, 15), 3)
})

test('child lookup returns siblings and stops at the last level', () => {
    const { core } = fixture()
    assert.deepEqual(core.getChildren(1, 1), [2, 3, 6, 7])
    assert.equal(core.getChildren(core.maxLevel, 0), null)
    assert.equal(core.getChildren(-1, 0), null)
})

test('single tail and interior deletion maintain key index and callbacks', () => {
    const { core } = fixture()
    core.updateMultiCellRenderInfo(cells([10, 11, 12, 13], 1, [0, 1, 0, 1]))
    const changes: PatchCellChange[] = []
    core.addChangeListener(change => changes.push(change))
    let tailCalled = false
    core.deleteCellLocally(3, (info: [number, number]) => {
        tailCalled = true
        assert.deepEqual(info, [3, 3])
    })
    assert.equal(tailCalled, true)
    assert.equal(core.getStorageId(1, 13), undefined)
    assert.equal(core.cellNum, 3)
    core.deleteCellLocally(0, (info: [number, number]) => assert.deepEqual(info, [2, 0]))
    assert.equal(core.getStorageId(1, 10), undefined)
    assert.equal(core.getStorageId(1, 12), 0)
    assert.equal(core.isDeleted(0), false)
    assert.deepEqual(changes[1], { removed: [0, 2], upserted: [0] })
})

test('multi deletion compacts mixed tail holes and preserves deleted flags', () => {
    const { core } = fixture()
    core.updateMultiCellRenderInfo(cells([0, 1, 2, 3, 4, 5], 1, [0, 0, 0, 0, 1, 0]))
    let change: PatchCellChange | undefined
    core.addChangeListener(next => { change = next })
    core.deleteCellsLocally([1, 5, 3], (info: [number[], number[]]) => assert.deepEqual(info, [[4], [1]]))
    assert.equal(core.cellNum, 3)
    assert.equal(core.getStorageId(1, 4), 1)
    assert.equal(core.isDeleted(1), true)
    assert.equal(core.getStorageId(1, 1), undefined)
    assert.equal(core.getStorageId(1, 3), undefined)
    assert.equal(core.getStorageId(1, 5), undefined)
    assert.deepEqual(change, { removed: [1, 3, 5, 4], upserted: [1] })
    core.deleteCellsLocally([0, 1, 2], (info: [number[], number[]]) => assert.deepEqual(info, [[], []]))
    assert.equal(core.cellNum, 0)
    assert.equal((core as unknown as { _cells: Map<number, unknown> })._cells.size, 0)
    assert.equal(core.getStorageId(1, 4), undefined)
})

test('compaction keeps every surviving key reachable across deletion patterns', () => {
    for (let mask = 0; mask < 1 << 6; mask++) {
        const { core } = fixture()
        const keys = [10, 11, 12, 13, 14, 15]
        core.updateMultiCellRenderInfo(cells(keys))
        const removed = keys.map((_, id) => id).filter(id => (mask & (1 << id)) !== 0)
        core.deleteCellsLocally(removed)
        const remaining = keys.filter((_, id) => !removed.includes(id))
        assert.equal(core.cellNum, remaining.length)
        for (const key of keys) {
            const storageId = core.getStorageId(1, key)
            if (remaining.includes(key)) {
                assert.notEqual(storageId, undefined)
                assert.ok(storageId! < core.cellNum)
                assert.deepEqual(core.getInfoByStorageId(storageId!), [1, key])
            } else {
                assert.equal(storageId, undefined)
            }
        }
    }
})

test('mark, restore, subdivide and merge retain worker and callback behavior', () => {
    const { core, calls } = fixture({
        subdivideCells: cells([2, 3, 6, 7], 2),
        mergeCells: cells([1], 1),
    })
    core.updateMultiCellRenderInfo(cells([1, 2], 1))
    const changes: PatchCellChange[] = []
    core.addChangeListener(change => changes.push(change))
    let callbacks = 0
    core.markCellsAsDeleted([0], () => callbacks++)
    assert.equal(core.isDeleted(0), true)
    core.restoreCells([0], () => callbacks++)
    assert.equal(core.isDeleted(0), false)
    core.deleteCellLocally(0)
    core.subdivideCells({ levels: new Uint8Array([1]), globalIds: new Uint32Array([1]) }, () => callbacks++)
    assert.equal(core.getStorageId(2, 2), 1)
    assert.equal(core.getStorageId(2, 3), 2)
    core.mergeCells([1, 2, 3, 4], (result: { childStorageIds: number[]; parentInfo: MultiCellBaseInfo }) => {
        callbacks++
        assert.deepEqual(result.childStorageIds, [1, 2, 3, 4])
        assert.equal(result.parentInfo.globalIds[0], 1)
    })
    assert.equal(callbacks, 4)
    assert.deepEqual(calls, ['deleteCells', 'restoreCells', 'subdivideCells', 'mergeCells'])
    assert.deepEqual(changes.slice(0, 2), [
        { removed: [], upserted: [0] },
        { removed: [], upserted: [0] },
    ])
})
