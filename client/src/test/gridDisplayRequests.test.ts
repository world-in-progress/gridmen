import assert from 'node:assert/strict'
import { setMaxListeners } from 'node:events'
import test, { type TestContext } from 'node:test'
import { blockKey } from '../src/core/grid/displayHierarchy'
import type { DisplayBlock, DisplayBlockDecoder, GridDisplayMeta } from '../src/core/grid/displayTypes'
import { createGridDisplayBlockCache, getGridDisplayMeta, GridDisplayHttpError, inspectGrid } from '../src/template/api/grid'

function deferred<T>() {
    let resolve!: (value: T) => void, reject!: (reason: unknown) => void
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
    // A header failure can leave the fixture's body deferred unused.
    void promise.catch(() => {})
    return { promise, resolve, reject }
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve))
const blocks = (count: number, offset = 0): DisplayBlock[] => Array.from({ length: count }, (_, x) =>
    ({ blockLayer: 0, x: x + offset, y: 0, displayLayer: 0 }))
const meta = { revision: 'revision-1', epsg: 4326, bounds: [0, 0, 1000, 1],
    alignment_origin: [0, 0], grid_info: [[1, 1]], elevationRange: [0, 1], landClasses: [0], displayLayers: [] } as GridDisplayMeta
const decode: DisplayBlockDecoder = async entries => entries.map(({ block, buffer }) => {
    assert.equal(new DataView(buffer).getUint32(0), block.x, 'body remains paired with its requested block')
    return { chunks: [{ key: blockKey(block), bounds: [block.x, 0, block.x + 1, 1],
        cells: [{ id: block.x, bounds: [block.x, 0, block.x + 1, 1], level: 0, elevation: 0, landClass: 0 }], fields: [] }], prepared: [] }
})

function fixture(t: TestContext, holdAborts = false) {
    const calls: { url: string; signal: AbortSignal; bodyRead: boolean; headers(status?: number, payload?: unknown): void;
        finish(): void; settleAbort(): void }[] = []
    const active = new Set<(typeof calls)[number]>()
    const controllers: AbortController[] = []
    let peak = 0
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal
        assert.ok(signal, 'the API forwards the original signal')
        assert.equal(signal.aborted, false, 'cancelled queued work must never reach fetch')
        const headers = deferred<Response>(), body = deferred<ArrayBuffer>()
        const close = () => { active.delete(call); signal.removeEventListener('abort', abort) }
        const abort = () => { if (!holdAborts) call.settleAbort() }
        const call = { url: String(input), signal, bodyRead: false,
            headers(status = 200, payload: unknown = null) {
                headers.resolve({ ok: status >= 200 && status < 300, status,
                    async arrayBuffer() {
                        call.bodyRead = true
                        try { return await body.promise } finally { close() }
                    },
                    async text() { close(); return String(payload) },
                    async json() { close(); return payload },
                } as Response)
            },
            finish() {
                const buffer = new ArrayBuffer(4)
                new DataView(buffer).setUint32(0, Number(call.url.split('/').at(-3)))
                body.resolve(buffer)
            },
            settleAbort() { headers.reject(signal.reason); body.reject(signal.reason); close() },
        }
        calls.push(call); active.add(call); peak = Math.max(peak, active.size)
        signal.addEventListener('abort', abort, { once: true })
        try { return await headers.promise } catch (error) { close(); throw error }
    })
    t.after(async () => {
        controllers.forEach(controller => controller.abort())
        calls.forEach(call => call.settleAbort())
        await flush()
    })
    return { calls, active, get peak() { return peak },
        controller() {
            const controller = new AbortController()
            setMaxListeners(0, controller.signal)
            controllers.push(controller)
            return controller
        },
        async finishAll() {
            for (let wave = 0; active.size; wave++) {
                assert.ok(wave < 1000, 'requests eventually drain')
                for (const call of [...active].reverse()) { call.headers(); call.finish() }
                await flush()
            }
        },
    }
}

function query(f: ReturnType<typeof fixture>, source: string, count: number, controller = f.controller(), revision = meta.revision, offset = 0) {
    const result = createGridDisplayBlockCache(`https://grid.invalid::${source}`, { ...meta, revision })
        .query(blocks(count, offset), controller.signal, decode)
    void result.catch(() => {})
    return result
}

test('hundreds of nodes keep six fetches active and preserve block/result order despite reversed completion', async t => {
    const f = fixture(t)
    const result = query(f, 'large', 300)
    await flush()
    assert.equal(f.calls.length, 6)
    await f.finishAll()
    assert.equal(f.calls.length, 300)
    assert.equal(f.peak, 6)
    assert.deepEqual((await result).chunks.map(chunk => chunk.cells[0].id), blocks(300).map(block => block.x))
})

test('response headers do not release a node slot before arrayBuffer finishes', async t => {
    const f = fixture(t)
    const result = query(f, 'body', 7)
    f.calls.forEach(call => call.headers())
    await flush()
    assert.ok(f.calls.every(call => call.bodyRead))
    assert.equal(f.calls.length, 6)
    f.calls[3].finish()
    await flush()
    assert.equal(f.calls.length, 7)
    assert.equal(f.active.size, 6)
    await f.finishAll()
    await result
})

test('different sources, revisions and simultaneous queries share the same six slots', async t => {
    const f = fixture(t)
    const controller = f.controller()
    const a = query(f, 'a', 4, controller)
    const b = query(f, 'b', 4, f.controller(), 'revision-2')
    const c = query(f, 'a', 4, controller, 'revision-1', 10)
    assert.equal(f.calls.length, 6)
    assert.equal(f.calls.filter(call => call.url.includes('/a/')).length, 4)
    await f.finishAll()
    assert.equal(f.calls.length, 12)
    assert.equal(f.peak, 6)
    await Promise.all([a, b, c])
})

test('abort drops queued nodes without fetch, preserves the reason and holds running body slots until they settle', async t => {
    const f = fixture(t, true)
    const controller = f.controller()
    const obsolete = query(f, 'old', 300, controller)
    assert.equal(f.calls.length, 6)
    f.calls.forEach(call => call.headers())
    await flush()
    const reason = new DOMException('source replaced', 'AbortError')
    controller.abort(reason)
    await assert.rejects(obsolete, error => error === reason)
    assert.equal(f.calls.length, 6)
    assert.ok(f.calls.every(call => call.signal === controller.signal && call.signal.aborted))
    const fresh = query(f, 'old', 8, f.controller(), 'revision-2')
    await flush()
    assert.equal(f.calls.length, 6, 'abort alone does not free running fetch/body slots')
    f.calls.slice(0, 6).forEach(call => call.settleAbort())
    await flush()
    assert.equal(f.calls.length, 12)
    await f.finishAll()
    assert.equal((await fresh).chunks.length, 8)
    assert.equal(f.calls.filter(call => call.url.includes('/nodes/revision-1/')).length, 6)
    assert.equal(f.calls.length, 14)
    assert.equal(f.peak, 6)
})

test('cancelling one source leaves another source queued and able to finish', async t => {
    const f = fixture(t)
    const controller = f.controller()
    const cancelled = query(f, 'cancelled', 300, controller)
    const surviving = query(f, 'surviving', 12)
    controller.abort()
    await assert.rejects(cancelled, error => error === controller.signal.reason)
    await flush()
    assert.equal(f.calls.filter(call => call.url.includes('/cancelled/')).length, 6)
    assert.equal(f.calls.filter(call => call.url.includes('/surviving/')).length, 6)
    await f.finishAll()
    assert.equal((await surviving).chunks.length, 12)
    assert.equal(f.calls.length, 18)
    assert.equal(f.peak, 6)
})

test('meta and inspect bypass occupied nodes slots', async t => {
    const f = fixture(t)
    const nodes = query(f, 'busy', 8)
    const signal = f.controller().signal
    const metadata = getGridDisplayMeta('https://grid.invalid::busy', signal)
    const inspection = inspectGrid('https://grid.invalid::busy', 2, 3, signal)
    assert.equal(f.calls.length, 8)
    assert.ok(f.calls[6].url.endsWith('/meta'))
    assert.ok(f.calls[7].url.endsWith('/inspect?x=2&y=3'))
    f.calls[6].headers(200, meta)
    f.calls[7].headers(200, { cell: null, neighbors: [] })
    assert.equal((await metadata).revision, meta.revision)
    assert.deepEqual(await inspection, { cell: null, neighbors: [] })
    assert.equal(f.calls.length, 8, 'nodes still await their body slots')
    await f.finishAll()
    await nodes
})

test('ordinary HTTP errors and revision 409 retain their status and detail without retries', async t => {
    const f = fixture(t)
    for (const status of [422, 409]) {
        const before = f.calls.length
        const result = query(f, `error-${status}`, 1)
        f.calls[before].headers(status, 'original server detail')
        await assert.rejects(result, error => error instanceof GridDisplayHttpError
            && error.status === status && error.message.includes('original server detail'))
        assert.equal(f.calls.length, before + 1)
    }
    const next = query(f, 'after-error', 7)
    await f.finishAll()
    assert.equal((await next).chunks.length, 7)
    assert.equal(f.peak, 6)
})
