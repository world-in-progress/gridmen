import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import type { GridDisplayMeta, ReadOnlyGridSource } from '../src/core/grid/displayTypes'
import { getGridDisplayMeta, GridDisplayHttpError } from '../src/template/api/grid'
import { displayLayers } from '../src/core/grid/displayHierarchy'
import { DisplayViewCache } from '../src/core/grid/displayBlockCache'

const tick = () => new Promise<void>(resolve => setImmediate(resolve))
function deferred<T>() {
    let resolve!: (value: T) => void
    return { promise: new Promise<T>(r => { resolve = r }), resolve }
}
const meta = (revision: string): GridDisplayMeta => ({ revision, epsg: 4326, bounds: [0, 0, 4, 4],
    alignment_origin: [0, 0], grid_info: [[1, 1]], elevationRange: [0, 1], landClasses: [0],
    displayLayers: displayLayers([0, 0, 4, 4], [[1, 1]], [0, 0], 1) })

function sessionFixture(readMeta: (signal: AbortSignal) => Promise<GridDisplayMeta>) {
    const require = createRequire(resolve('package.json'))
    const ts = require('typescript') as typeof import('typescript')
    const listeners = new Set<(error: unknown | null) => void>()
    const sources: ReadOnlyGridSource[] = []
    const signals: AbortSignal[] = []
    let removed = 0
    let failSource: ((source: ReadOnlyGridSource) => unknown) | undefined
    const layer = {
        addErrorListener(listener: (error: unknown | null) => void) { listeners.add(listener); listener(null); return () => listeners.delete(listener) },
        async setReadOnlySource(source: ReadOnlyGridSource) {
            sources.push(source)
            const error = failSource?.(source)
            if (error) { listeners.forEach(listener => listener(error)); throw error }
            listeners.forEach(listener => listener(null))
        },
    }
    const dependencies: Record<string, unknown> = {
        '../api/grid': {
            GridDisplayHttpError,
            getGridDisplayMeta: (_node: string, signal: AbortSignal) => { signals.push(signal); return readMeta(signal) },
            createGridDisplayBlockCache: () => new DisplayViewCache(),
            inspectGrid: async () => ({ cell: null, neighbors: [] }),
        },
        '@/components/gridDisplay/displayBounds': { displayBoundsOn4326: async () => [0, 0, 4, 4] },
        '@/components/gridDisplay/mapReady': { waitForDisplayMap: async () => {} },
        '@/views/mapView/layerOrderCoordinator': { layerOrderCoordinator: { register() {}, unregister() {} } },
        '@/views/mapView/topology/topologyLayerManager': {
            getOrCreatePerPatchTopology: () => ({ clgId: 'grid', topologyLayer: layer }),
            ensureTopologyLayerInitialized: async () => {},
            removePerPatchTopology: () => { removed++ },
        },
    }
    const code = ts.transpileModule(readFileSync(resolve('src/template/grid/gridDisplaySession.ts'), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const module = { exports: {} as { getGridDisplay(node: unknown, map: unknown): { promise: Promise<{ meta: GridDisplayMeta }>; listeners: Set<() => void>; dispose(): void } } }
    runInNewContext(`(function(require,module,exports){${code}\n})`, { AbortController, AbortSignal, DOMException, Promise })(
        (name: string) => { if (!(name in dependencies)) throw new Error(`Unexpected session dependency ${name}`); return dependencies[name] }, module, module.exports)
    return { ...module.exports, layer, sources, signals, emit: (error: unknown) => listeners.forEach(listener => listener(error)),
        fail: (failure: (source: ReadOnlyGridSource) => unknown) => { failSource = failure }, removed: () => removed }
}

test('HTTP metadata builds the single runtime hierarchy with read-only native levels', async t => {
    const originalFetch = globalThis.fetch
    t.after(() => { globalThis.fetch = originalFetch })
    const wire = { ...meta('http'), displayLayers: undefined }
    globalThis.fetch = async () => new Response(JSON.stringify(wire), { headers: { 'Content-Type': 'application/json' } })
    const result = await getGridDisplayMeta('https://grid.invalid::node')
    assert.deepEqual(result.displayLayers, displayLayers(wire.bounds, wire.grid_info, wire.alignment_origin, 1))
    assert.equal(result.displayLayers.find(layer => layer.nativeLevel !== null)?.nativeLevel, 1)
    globalThis.fetch = async () => new Response(JSON.stringify({ ...wire, grid_info: [] }))
    await assert.rejects(getGridDisplayMeta('https://grid.invalid::node'), /Invalid grid display metadata/)
    globalThis.fetch = async () => new Response('revision changed', { status: 409 })
    await assert.rejects(getGridDisplayMeta('https://grid.invalid::node'), error => error instanceof GridDisplayHttpError && error.status === 409)
})

test('409 replaces session.promise, serializes refresh and exposes fresh metadata', async () => {
    const next = deferred<GridDisplayMeta>()
    let calls = 0, active = 0, maxActive = 0
    const f = sessionFixture(async () => {
        calls++; active++; maxActive = Math.max(maxActive, active)
        try { return calls === 1 ? meta('old') : await next.promise }
        finally { active-- }
    })
    const session = f.getGridDisplay({ nodeInfo: 'node' }, {})
    assert.equal((await session.promise).meta.revision, 'old')
    const old = session.promise
    const revisions: Promise<unknown>[] = []
    session.listeners.add(() => revisions.push(session.promise))
    const error = new GridDisplayHttpError(409, 'revision changed')
    f.emit(error); f.emit(error); f.emit(error)
    assert.notEqual(session.promise, old)
    assert.equal(f.signals[0].aborted, true)
    await tick()
    assert.equal(calls, 2)
    assert.equal(revisions.length, 1)
    next.resolve(meta('new'))
    assert.equal((await session.promise).meta.revision, 'new')
    assert.deepEqual(f.sources.map(source => source.meta.revision), ['old', 'new'])
    assert.equal(maxActive, 1)
    session.dispose()
    assert.equal(f.signals.at(-1)?.aborted, true)
    assert.equal(f.removed(), 1)
})

test('revision churn is sequential and has no arbitrary retry-count cutoff', async () => {
    let calls = 0
    const f = sessionFixture(async () => meta(String(++calls)))
    f.fail(source => Number(source.meta.revision) <= 6 ? new GridDisplayHttpError(409, 'changed again') : null)
    const session = f.getGridDisplay({ nodeInfo: 'node' }, {})
    assert.equal((await session.promise).meta.revision, '7')
    assert.equal(calls, 7)
    assert.ok(f.signals.slice(0, -1).every(signal => signal.aborted))
    session.dispose()
})

test('disposal during revision refresh prevents the late source from mounting', async () => {
    const next = deferred<GridDisplayMeta>()
    let calls = 0
    const f = sessionFixture(async () => ++calls === 1 ? meta('old') : next.promise)
    const session = f.getGridDisplay({ nodeInfo: 'node' }, {})
    await session.promise
    f.emit(new GridDisplayHttpError(409, 'changed'))
    const rejected = assert.rejects(session.promise, { name: 'AbortError' })
    await tick()
    session.dispose()
    next.resolve(meta('late'))
    await rejected
    assert.deepEqual(f.sources.map(source => source.meta.revision), ['old'])
})
