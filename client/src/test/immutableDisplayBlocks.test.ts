import assert from 'node:assert/strict'
import test from 'node:test'
import { DisplayBlockCache } from '../src/core/grid/displayBlockCache'
import { blockKey } from '../src/core/grid/displayHierarchy'
import type { DisplayBlock, DisplayChunk, GridDisplayMeta } from '../src/core/grid/displayTypes'

const block = (x: number): DisplayBlock => ({ blockLayer: 1, displayLayer: 0, x, y: 0 })
const chunk = (b: DisplayBlock): DisplayChunk => ({ key: blockKey(b), bounds: [b.x, 0, b.x + 1, 1], cells: [], fields: b.x % 2 ? [] : [{ bounds: [b.x, 0, b.x + 1, 1], occupiedFraction: 0.25, elevation: 1, minCellSize: 0.1, landClass: 1, level: 1 }] })
const meta = { cellCount: 100, revision: 'immutable' } as GridDisplayMeta

test('immutable decoded blocks, including empty responses, survive overlapping views without another load', async () => {
    const reads: number[][] = []
    const cache = new DisplayBlockCache(meta, async blocks => { reads.push(blocks.map(b => b.x)); return blocks.map(chunk) })
    const signal = new AbortController().signal
    const first = await cache.query([block(0), block(1), block(2)], signal)
    cache.retain([block(0), block(1), block(2)], true)
    const second = await cache.query([block(0), block(1), block(2)], signal)
    assert.equal(first.chunks[0], second.chunks[0])
    const pan = await cache.query([block(2), block(3), block(4)], signal)
    cache.retain([block(2), block(3), block(4)], true)
    assert.equal(first.chunks[1], pan.chunks[0])
    await cache.query([block(0), block(1), block(2)], signal)
    assert.deepEqual(reads, [[0, 1, 2], [3, 4]])
    for (let x = 10; x < 100; x += 2) {
        const blocks = [block(x), block(x + 1)]
        await cache.query(blocks, signal)
        cache.retain(blocks, true)
    }
    const stored = cache as unknown as { chunks: Map<string, DisplayChunk> }
    assert.ok(stored.chunks.size <= 4)
    await cache.query([block(0), block(1)], signal)
    assert.deepEqual(reads.at(-1), [0, 1])
})

test('intermediate requests cannot evict either completed zoom endpoint; retention stays within four view footprints', async () => {
    let reads = 0
    const cache = new DisplayBlockCache(meta, async blocks => { reads += blocks.length; return blocks.map(chunk) })
    const signal = new AbortController().signal
    const a = [block(0), block(1), block(2)], b = [block(30), block(31), block(32)]
    await cache.query(a, signal); cache.retain(a, true)
    for (let x = 4; x < 24; x += 2) {
        const moving = [block(x), block(x + 1)]
        await cache.query(moving, signal); cache.retain(moving, false)
    }
    await cache.query(b, signal); cache.retain(b, true)
    for (let x = 40; x < 60; x += 2) {
        const moving = [block(x), block(x + 1)]
        await cache.query(moving, signal); cache.retain(moving, false)
        assert.ok((cache as unknown as { chunks: Map<string, DisplayChunk> }).chunks.size <= a.length + b.length + moving.length)
    }
    const before = reads
    await cache.query(a, signal); cache.retain(a, true)
    await cache.query(b, signal); cache.retain(b, true)
    assert.equal(reads, before)
    cache.clear()
    assert.equal((cache as unknown as { chunks: Map<string, DisplayChunk> }).chunks.size, 0)
})

test('clearing a source or aborting cannot repopulate it from a late decoded response', async () => {
    let finish!: (chunks: DisplayChunk[]) => void
    const cache = new DisplayBlockCache(meta, () => new Promise(resolve => { finish = resolve }))
    const signal = new AbortController()
    const pending = cache.query([block(0)], signal.signal)
    cache.clear()
    finish([chunk(block(0))])
    await assert.rejects(pending, { name: 'AbortError' })
    const aborted = cache.query([block(0)], signal.signal)
    signal.abort()
    finish([chunk(block(0))])
    await assert.rejects(aborted, { name: 'AbortError' })
    assert.equal((cache as unknown as { chunks: Map<string, DisplayChunk> }).chunks.size, 0)
})

test('different source/revision instances never share decoded identity, and load failures stay explicit', async () => {
    const source = () => new DisplayBlockCache(meta, async blocks => blocks.map(chunk))
    const signal = new AbortController().signal
    const a = await source().query([block(0)], signal)
    const b = await source().query([block(0)], signal)
    assert.notEqual(a.chunks[0], b.chunks[0])
    const broken = new DisplayBlockCache(meta, async () => { throw new Error('Invalid grid display format') })
    await assert.rejects(broken.query([block(0)], signal), /Invalid grid display format/)
})
