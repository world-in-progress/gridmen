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
import { fixture as topologyFixture, view } from './topologyFixture'
import i18n from '../src/i18n'
import { errorMessage } from '../src/i18n/gridDisplay'
import * as colors from '../src/core/grid/displayColors'
import type TopologyLayer from '../src/views/mapView/topology/TopologyLayer'

const tick = () => new Promise<void>(resolve => setImmediate(resolve))
function deferred<T>() {
    let resolve!: (value: T) => void
    return { promise: new Promise<T>(r => { resolve = r }), resolve }
}
const meta = (revision: string): GridDisplayMeta => ({ revision, epsg: 4326, bounds: [0, 0, 4, 4],
    alignment_origin: [0, 0], grid_info: [[1, 1]], elevationRange: [0, 1], landClasses: [0],
    displayLayers: displayLayers([0, 0, 4, 4], [[1, 1]], [0, 0], 1) })

function sessionFixture(readMeta: (signal: AbortSignal) => Promise<GridDisplayMeta>, topology?: ReturnType<typeof topologyFixture>) {
    const require = createRequire(resolve('package.json'))
    const ts = require('typescript') as typeof import('typescript')
    let onRevisionChanged: (() => void) | undefined
    const sources: ReadOnlyGridSource[] = []
    const signals: AbortSignal[] = []
    let removed = 0
    let failSource: ((source: ReadOnlyGridSource) => unknown) | undefined
    const layer = {
        async setReadOnlySource(source: ReadOnlyGridSource, refresh?: () => void) {
            onRevisionChanged = refresh
            sources.push(source)
            const error = failSource?.(source)
            if (error) {
                if (error instanceof GridDisplayHttpError && error.status === 409) onRevisionChanged?.()
                throw error
            }
        },
    }
    const dependencies: Record<string, unknown> = {
        '../api/grid': {
            GridDisplayHttpError,
            getGridDisplayMeta: (_node: string, signal: AbortSignal) => { signals.push(signal); return readMeta(signal) },
            createGridDisplayBlockCache: () => topology
                ? Object.assign(topology.source.cache, { query: topology.source.loadBlocks }) : new DisplayViewCache(),
            inspectGrid: async (_node: string, _x: number, _y: number, signal: AbortSignal) => {
                if (!topology) return { cell: null, neighbors: [] }
                return new Promise((resolve, reject) => {
                    const abort = () => reject(signal.reason)
                    signal.addEventListener('abort', abort, { once: true })
                    void topology.source.inspect(0, 0).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
                })
            },
        },
        '@/components/gridDisplay/displayBounds': { displayBoundsOn4326: async () => [0, 0, 4, 4] },
        '@/components/gridDisplay/mapReady': { waitForDisplayMap: async () => {} },
        '@/views/mapView/layerOrderCoordinator': { layerOrderCoordinator: { register() {}, unregister() {} } },
        '@/views/mapView/topology/topologyLayerManager': {
            getOrCreatePerPatchTopology: () => ({ clgId: 'grid', topologyLayer: topology?.layer ?? layer }),
            ensureTopologyLayerInitialized: async () => {},
            removePerPatchTopology: () => { removed++ },
        },
    }
    const code = ts.transpileModule(readFileSync(resolve('src/template/grid/gridDisplaySession.ts'), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const module = { exports: {} as { getGridDisplay(node: unknown, map: unknown): { promise: Promise<{ meta: GridDisplayMeta }>; listeners: Set<() => void>; dispose(): void } } }
    runInNewContext(`(function(require,module,exports){${code}\n})`, { AbortController, AbortSignal, DOMException, Promise })(
        (name: string) => { if (!(name in dependencies)) throw new Error(`Unexpected session dependency ${name}`); return dependencies[name] }, module, module.exports)
    return { ...module.exports, layer, sources, signals, refresh: () => onRevisionChanged!(),
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
    f.refresh(); f.refresh(); f.refresh()
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
    f.refresh()
    const rejected = assert.rejects(session.promise, { name: 'AbortError' })
    await tick()
    session.dispose()
    next.resolve(meta('late'))
    await rejected
    assert.deepEqual(f.sources.map(source => source.meta.revision), ['old'])
})

test('a non-409 initial display failure evicts the grid session and reopening loads successfully', async () => {
    let calls = 0
    const f = sessionFixture(async () => meta(String(++calls)))
    f.fail(source => source.meta.revision === '1' ? new GridDisplayHttpError(500, 'HTTP 500 blocks unavailable') : null)
    const node = { nodeInfo: 'grid' }, map = {}
    const first = f.getGridDisplay(node, map)
    await assert.rejects(first.promise, /HTTP 500 blocks unavailable/)
    const second = f.getGridDisplay(node, map)
    assert.notEqual(first, second)
    assert.equal((await second.promise).meta.revision, '2')
    assert.equal(calls, 2)
    assert.equal(f.removed(), 1)
    assert.equal(f.signals[0].aborted, true)
    second.dispose()
})


// Run the real panel and inspection hook with observable hook state; rendering
// after every transition also catches a transient error before fresh meta lands.
function panelFixture(map: unknown, layer: TopologyLayer) {
    const require = createRequire(resolve('package.json'))
    const ts = require('typescript') as typeof import('typescript')
    const { renderToStaticMarkup } = require('react-dom/server') as typeof import('react-dom/server')
    const states: unknown[] = [], effects: (() => void | (() => void))[] = []
    let index = 0, mounted = false
    const react = {
        useState(initial: unknown) {
            const current = index++
            if (!mounted) states[current] = initial
            return [states[current], (value: unknown) => { states[current] = value }]
        },
        useEffect(effect: () => void | (() => void)) { if (!mounted) effects.push(effect) },
    }
    const translation = { errorMessage, useGridDisplayTranslation: () => ({ t: i18n.getFixedT('en', 'gridDisplay') }) }
    function load(file: string, dependencies: Record<string, unknown> = {}) {
        const code = ts.transpileModule(readFileSync(resolve('src/components/gridDisplay', file), 'utf8'),
            { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
        const module = { exports: {} }
        const deps = { react, '@/i18n/gridDisplay': translation, '@/core/grid/displayColors': colors, ...dependencies }
        runInNewContext(`(function(require,module,exports){${code}\n})`, { Error })(
            (name: string) => name in deps ? deps[name as keyof typeof deps] : require(name), module, module.exports)
        return module.exports as Record<string, (props: never) => import('react').ReactNode>
    }
    const Panel = load('GridDisplayPanel.tsx', {
        './useGridInspection': load('useGridInspection.ts'),
        './GridInspector': load('GridInspector.tsx'),
    }).default
    return {
        render() {
            index = 0
            const html = renderToStaticMarkup(Panel({ map, layer, attributes: ['level'], gridInfo: [[1, 1]] } as never))
            mounted = true
            return html
        },
        mount: () => effects.map(effect => effect()),
    }
}

test('real viewport 409 clears old geometry, refreshes metadata and never renders a panel error while inspection is canceled', async t => {
    const topology = topologyFixture(t)
    const next = deferred<GridDisplayMeta>()
    const inspecting = deferred<{ cell: null; neighbors: [] }>()
    let metaCalls = 0, inspectCalls = 0
    topology.source.inspect = async () => ++inspectCalls === 1 ? inspecting.promise : { cell: view.chunks[0].cells[0], neighbors: [] }
    const f = sessionFixture(async () => ++metaCalls === 1 ? topology.source.meta : next.promise, topology)
    const node = { nodeInfo: 'grid' }
    const session = f.getGridDisplay(node, topology.camera)
    await tick()
    topology.calls[0].resolve(view)
    await session.promise
    topology.layer.attribute = 'level'
    const panel = panelFixture(topology.camera, topology.layer)
    panel.render()
    const cleanups = panel.mount()
    t.after(() => cleanups.forEach(cleanup => cleanup?.()))
    const assertNoError = () => {
        const html = panel.render()
        assert.ok(!html.includes('role="alert"') && !html.includes('409') && !html.includes('Unable to inspect'), html)
        return html
    }
    const click = [...topology.camera.listeners.get('click')!][0] as unknown as (event: unknown) => Promise<void>
    const pendingInspection = click({ point: { x: 20, y: 20 } })
    assert.match(assertNoError(), /Inspecting/)
    topology.camera.center = 100
    topology.camera.emit('move')
    await topology.frame()
    assert.equal(topology.calls.length, 2)
    const previous = session.promise
    topology.calls[1].reject(new GridDisplayHttpError(409, 'HTTP 409 revision changed'))
    await tick()
    assertNoError()
    assert.notEqual(session.promise, previous)
    assert.equal(metaCalls, 2)
    assert.equal(f.signals[0].aborted, true)
    assert.equal(Reflect.get(topology.layer, '_view').chunks.length, 0)
    await pendingInspection
    assert.ok(!assertNoError().includes('Inspecting'))
    inspecting.resolve({ cell: null, neighbors: [] })
    next.resolve({ ...topology.source.meta, revision: 'fresh' })
    await tick()
    assert.equal(topology.calls.length, 3)
    assertNoError()
    topology.calls[2].resolve(view)
    assert.equal((await session.promise).meta.revision, 'fresh')
    assert.equal(topology.layer.isReady, true)
    assert.equal(Reflect.get(topology.layer, '_view').chunks.length, 1)
    assertNoError()
    await click({ point: { x: 20, y: 20 } })
    assert.equal(inspectCalls, 2)
    assert.match(assertNoError(), /<dt>Cell ID<\/dt><dd>1<\/dd>/)
    topology.camera.center = 200
    topology.camera.emit('move')
    await topology.frame()
    topology.calls[3].reject(new GridDisplayHttpError(500, 'HTTP 500 viewport unavailable'))
    await tick()
    assert.match(panel.render(), /role="alert"[^>]*>Unable to load viewport: HTTP 500 viewport unavailable/)
    session.dispose()
})
