import assert from 'node:assert/strict'
import test from 'node:test'
import { DisplayBlockCache, DisplayViewCache } from '../src/core/grid/displayBlockCache'
import { blockKey } from '../src/core/grid/displayHierarchy'
import type { DisplayBlock, DisplayChunk, DecodedDisplayBlock, DisplayBlockDecoder } from '../src/core/grid/displayTypes'

const block = (x: number): DisplayBlock => ({ blockLayer: 1, displayLayer: 0, x, y: 0 })
const chunk = (b: DisplayBlock): DisplayChunk => ({ key: blockKey(b), bounds: [b.x, 0, b.x + 1, 1], cells: [], fields: b.x % 2 ? [] : [{ bounds: [b.x, 0, b.x + 1, 1], occupiedFraction: 0.25, elevation: 1, minCellSize: 0.1, landClass: 1, level: 1 }] })
const decoded = (b: DisplayBlock): DecodedDisplayBlock => ({ chunks: [chunk(b)], prepared: [] })
const decode: DisplayBlockDecoder = async () => { throw new Error('Unexpected decode in cache fixture') }

test('immutable decoded blocks, including empty responses, survive overlapping views without another load', async () => {
    const reads: number[][] = []
    const cache = new DisplayBlockCache( async blocks => { reads.push(blocks.map(b => b.x)); return blocks.map(decoded) })
    const signal = new AbortController().signal
    const first = await cache.query([block(0), block(1), block(2)], signal, decode)
    cache.retain([block(0), block(1), block(2)].map(blockKey), true)
    const second = await cache.query([block(0), block(1), block(2)], signal, decode)
    assert.equal(first.chunks[0], second.chunks[0])
    const pan = await cache.query([block(2), block(3), block(4)], signal, decode)
    cache.retain([block(2), block(3), block(4)].map(blockKey), true)
    assert.equal(first.chunks[1], pan.chunks[0])
    await cache.query([block(0), block(1), block(2)], signal, decode)
    assert.deepEqual(reads, [[0, 1, 2], [3, 4]])
    for (let x = 10; x < 100; x += 2) {
        const blocks = [block(x), block(x + 1)]
        await cache.query(blocks, signal, decode)
        cache.retain(blocks.map(blockKey), true)
    }
    const stored = cache as unknown as { chunks: Map<string, DisplayChunk> }
    assert.ok(stored.chunks.size <= 4)
    await cache.query([block(0), block(1)], signal, decode)
    assert.deepEqual(reads.at(-1), [0, 1])
})

test('intermediate requests cannot evict either completed zoom endpoint; retention stays within four view footprints', async () => {
    let reads = 0
    const cache = new DisplayBlockCache( async blocks => { reads += blocks.length; return blocks.map(decoded) })
    const signal = new AbortController().signal
    const a = [block(0), block(1), block(2)], b = [block(30), block(31), block(32)]
    await cache.query(a, signal, decode); cache.retain(a.map(blockKey), true)
    for (let x = 4; x < 24; x += 2) {
        const moving = [block(x), block(x + 1)]
        await cache.query(moving, signal, decode); cache.retain(moving.map(blockKey), false)
    }
    await cache.query(b, signal, decode); cache.retain(b.map(blockKey), true)
    for (let x = 40; x < 60; x += 2) {
        const moving = [block(x), block(x + 1)]
        await cache.query(moving, signal, decode); cache.retain(moving.map(blockKey), false)
        assert.ok((cache as unknown as { chunks: Map<string, DisplayChunk> }).chunks.size <= a.length + b.length + moving.length)
    }
    const before = reads
    await cache.query(a, signal, decode); cache.retain(a.map(blockKey), true)
    await cache.query(b, signal, decode); cache.retain(b.map(blockKey), true)
    assert.equal(reads, before)
    cache.clear()
    assert.equal((cache as unknown as { chunks: Map<string, DisplayChunk> }).chunks.size, 0)
})

test('clearing a source or aborting cannot repopulate it from a late decoded response', async () => {
    let finish!: (chunks: DecodedDisplayBlock[]) => void
    const cache = new DisplayBlockCache( () => new Promise(resolve => { finish = resolve }))
    const signal = new AbortController()
    const pending = cache.query([block(0)], signal.signal, decode)
    cache.clear()
    finish([decoded(block(0))])
    await assert.rejects(pending, { name: 'AbortError' })
    const aborted = cache.query([block(0)], signal.signal, decode)
    signal.abort()
    finish([decoded(block(0))])
    await assert.rejects(aborted, { name: 'AbortError' })
    assert.equal((cache as unknown as { chunks: Map<string, DisplayChunk> }).chunks.size, 0)
})

test('different source/revision instances never share decoded identity, and load failures stay explicit', async () => {
    const source = () => new DisplayBlockCache( async blocks => blocks.map(decoded))
    const signal = new AbortController().signal
    const a = await source().query([block(0)], signal, decode)
    const b = await source().query([block(0)], signal, decode)
    assert.notEqual(a.chunks[0], b.chunks[0])
    const broken = new DisplayBlockCache( async () => { throw new Error('Invalid grid display format') })
    await assert.rejects(broken.query([block(0)], signal, decode), /Invalid grid display format/)
})


test('published and candidate versions of an edited block retain their own prepared geometry', () => {
    const cache = new DisplayViewCache()
    const key = blockKey(block(0))
    const original = chunk(block(0)), replacement = chunk(block(0))
    const prepared = { data: new Float32Array(16), origin: [0, 0] as [number, number], corners: [], worldBounds: [0, 0, 1, 1] as [number, number, number, number] }
    cache.begin([key]); cache.setBlock(key, [original], [prepared]); cache.retain([key], true)
    cache.deleteNode('1:0:0')
    cache.begin([key]); cache.setBlock(key, [replacement])
    assert.equal(cache.getPrepared(original), prepared)
    assert.equal(cache.getPrepared(replacement), undefined)
    cache.setPrepared(replacement, { ...prepared })
    cache.retain([key], true)
    assert.equal(cache.getPrepared(original), prepared)
    for (const x of [10, 20]) {
        const next = blockKey(block(x))
        cache.begin([next]); cache.setBlock(next, [chunk(block(x))]); cache.retain([next], true)
    }
    assert.equal(cache.getPrepared(original), undefined)
    assert.equal(cache.getPrepared(replacement), undefined)
})

test('crossing originals share one cached canonical chunk and prepared object across blocks', () => {
    const cache = new DisplayViewCache()
    const keys = [blockKey(block(0)), blockKey(block(1))]
    const cell = { id: 7, bounds: [0, 0, 2, 1] as [number, number, number, number], level: 1, elevation: 0.123456789123, landClass: 3 }
    const original = { key: 'original:7', bounds: cell.bounds, cells: [cell], fields: [] }
    const prepared = { data: new Float32Array(16), origin: [0, 0] as [number, number], corners: [], worldBounds: cell.bounds }
    cache.begin(keys)
    cache.setBlock(keys[0], [original], [prepared])
    const [shared] = cache.setBlock(keys[1], [{ ...original, cells: [{ ...cell }] }], [undefined])
    assert.equal(shared, original)
    assert.deepEqual(cache.view(keys).chunks, [original])
    assert.equal(cache.getPrepared(shared), prepared)
    assert.equal(shared.cells[0].elevation, cell.elevation)
})

test('a viewport larger than 768 blocks has no cache capacity cutoff and expires by footprint', () => {
    const cache = new DisplayViewCache()
    const keys = Array.from({ length: 1024 }, (_, x) => blockKey(block(x * 2)))
    cache.begin(keys)
    keys.forEach((key, x) => cache.setBlock(key, [chunk(block(x * 2))]))
    cache.retain(keys, true)
    assert.equal(cache.view(keys).chunks.length, 1024)
    const anchor = cache.getBlock(keys[0])![0]
    cache.begin(keys)
    assert.equal(cache.getBlock(keys[0])![0], anchor)
    for (const x of [4096, 8192]) {
        const key = blockKey(block(x))
        cache.begin([key]); cache.setBlock(key, [chunk(block(x))]); cache.retain([key], true)
    }
    assert.equal(cache.getBlock(keys[0]), undefined)
    const state = cache as unknown as { chunks: Map<unknown, unknown>; nodeBlocks: Map<string, unknown> }
    assert.equal(state.chunks.size, 2)
    assert.equal(state.nodeBlocks.size, 2)
})
