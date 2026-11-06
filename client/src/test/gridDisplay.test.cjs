const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const assert = require('node:assert/strict')
const { test } = require('node:test')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

function load(file, dependencies = {}, globals = {}) {
    const source = fs.readFileSync(path.resolve('src', file), 'utf8')
    const js = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
    } }).outputText
    const module = { exports: {} }
    const context = {
        module, exports: module.exports,
        require: id => Object.hasOwn(dependencies, id) ? dependencies[id] : require(id),
        console, AbortController, AbortSignal, URLSearchParams, Error, DOMException,
        navigator: { language: 'en-US' }, ...globals,
    }
    vm.runInNewContext(js, context, { filename: file })
    return module.exports
}
const i18n = load('i18n/gridDisplay.ts')
// These boundary values test UI wiring; this does not substitute for engine integration.
const colorContract = {
    ELEVATION_LOW_COLOR: [0.16, 0.40, 0.46],
    ELEVATION_HIGH_COLOR: [0.87, 0.76, 0.52],
    OUTLINE_DARKENING: 0.65,
    elevationColor: () => [0.23, 0.32, 0.41],
}
const mathContract = { outlineCoverage: (s, c) => {
    const u = Math.min(1, s / c)
    return 1 - (1 - u) ** 2
} }
const deferred = () => {
    let resolve, reject
    const promise = new Promise((a, b) => { resolve = a; reject = b })
    return { promise, resolve, reject }
}

class TestMap {
    handlers = new Map()
    ready = true
    isStyleLoaded() { return this.ready }
    on(event, fn) {
        if (!this.handlers.has(event)) this.handlers.set(event, new Set())
        this.handlers.get(event).add(fn)
    }
    off(event, fn) { this.handlers.get(event)?.delete(fn) }
    emit(event) { this.handlers.get(event)?.forEach(fn => fn()) }
    listenerCount() { return [...this.handlers.values()].reduce((n, s) => n + s.size, 0) }
}
const readiness = load('components/gridDisplay/mapReady.ts')

test('map readiness removes both map events on ready and abort', async () => {
    const map = new TestMap()
    map.ready = false
    const controller = new AbortController()
    const ready = readiness.waitForDisplayMap(map, controller.signal)
    assert.equal(map.listenerCount(), 2)
    map.emit('style.load')
    await ready
    assert.equal(map.listenerCount(), 0)
    const canceled = readiness.waitForDisplayMap(map, controller.signal)
    controller.abort()
    await assert.rejects(canceled, { name: 'AbortError' })
    assert.equal(map.listenerCount(), 0)
})

test('API uses encoded node keys, revision block paths, HTTP errors and abort signals', async () => {
    const calls = []
    const block = { blockLayer: 3, x: -2, y: 5, displayLayer: 1 }
    const meta = { revision: 'rev/a b', cellCount: 3 }
    const payload = new ArrayBuffer(8)
    let response = { ok: true, json: async () => ({ actual: true }), arrayBuffer: async () => payload }
    const decoded = []
    const api = load('template/api/grid.ts', {
        './utils': { decodeNodeInfo: () => ({ address: 'http://local.test', nodeKey: 'a/b grid' }) },
        '@/i18n/gridDisplay': i18n,
        '@/core/grid/displayWire': {
            decodeDisplayBlock: (buffer, requested, metadata) => {
                decoded.push([buffer, requested, metadata])
                return { key: 'block', bounds: [0, 0, 1, 1], cells: [], fields: [] }
            },
            displayBlockView: (chunks, cellCount) => ({ chunks, cellCount }),
        },
    }, { fetch: async (url, options) => { calls.push({ url, options }); return response } })
    const signal = new AbortController().signal
    assert.equal((await api.getGridDisplayMeta('node', signal)).actual, true)
    assert.equal(calls[0].url, 'http://local.test/api/grid/a%2Fb%20grid/display/meta')
    assert.equal(calls[0].options.signal, signal)
    assert.equal((await api.queryGridDisplayBlocks('node', meta, [block], signal)).cellCount, 3)
    assert.equal(calls[1].url, 'http://local.test/api/grid/a%2Fb%20grid/display/nodes/rev%2Fa%20b/3/-2/5/1')
    assert.equal(calls[1].options.method, undefined)
    assert.equal(calls[1].options.signal, signal)
    assert.deepEqual(decoded, [[payload, block, meta]])
    await api.inspectGrid('node', -10.5, 9, signal)
    assert.match(calls[2].url, /display\/inspect\?x=-10.5&y=9$/)
    response = { ok: false, status: 422, text: async () => 'corrupt topology' }
    await assert.rejects(api.getGridDisplayMeta('node'), /HTTP 422.*corrupt topology/)
    await assert.rejects(api.queryGridDisplayBlocks('node', meta, [block]), /corrupt topology/)
    await assert.rejects(api.inspectGrid('node', 1, 2), /corrupt topology/)
    assert.equal(api.getGridBlockMeta, undefined)
    assert.equal(typeof api.exportGridTopo, 'function')
})

function sessionDependencies() {
    const map = new TestMap()
    const meta = { revision: 'test', displayLayers: [], bounds: [0, 0, 10, 10], epsg: 4326, grid_info: [[1, 1]], subdivide_rules: [[2, 2]] }
    const counts = { created: 0, removed: 0, source: 0, core: 0, unregister: 0, link: 0, unlink: 0 }
    const layer = { setReadOnlySource: async source => { layer.source = source; counts.source++ } }
    const manager = {
        getOrCreatePerPatchTopology: () => { counts.created++; return { clgId: 'layer', topologyLayer: layer } },
        ensureTopologyLayerInitialized: async () => {},
        removePerPatchTopology: () => { counts.removed++ },
    }
    const dependencies = {
        '@/components/gridDisplay/displayBounds': { displayBoundsOn4326: async () => [0, 0, 10, 10] },
        './displayBounds': { displayBoundsOn4326: async () => [0, 0, 10, 10] },
        '@/i18n/gridDisplay': i18n,
        '@/components/gridDisplay/mapReady': readiness,
        './mapReady': readiness,
        '@/views/mapView/layerOrderCoordinator': { layerOrderCoordinator: {
            register: () => {}, unregister: () => { counts.unregister++ },
        } },
        '@/views/mapView/topology/topologyLayerManager': manager,
    }
    return { map, meta, counts, layer, dependencies }
}

test('grid tabs share one source, propagate viewport errors and cancel requests on node close', async () => {
    const ctx = sessionDependencies()
    let fail = false
    let observedSignal
    ctx.dependencies['../api/grid'] = {
        getGridDisplayMeta: async () => ctx.meta,
        queryGridDisplayBlocks: async (_node, _meta, _blocks, signal) => {
            observedSignal = signal
            if (fail) throw new Error('broken viewport')
            return { chunks: [], cellCount: 0 }
        },
        inspectGrid: async (_node, _x, _y, signal) => { observedSignal = signal; return { cell: null, neighbors: [] } },
    }
    const module = load('template/grid/gridDisplaySession.ts', ctx.dependencies)
    const node = { nodeInfo: 'grid', context: { existing: true } }
    const first = module.getGridDisplay(node, ctx.map)
    assert.equal(module.getGridDisplay(node, ctx.map), first)
    await first.promise
    assert.equal(ctx.counts.created, 1)
    assert.equal(ctx.counts.source, 1)
    assert.equal(node.context.existing, true)
    let notifications = 0
    first.listeners.add(() => notifications++)
    fail = true
    await assert.rejects(ctx.layer.source.loadBlocks([{ blockLayer: 0, x: 0, y: 0, displayLayer: 0 }], new AbortController().signal), /broken viewport/)
    assert.match(first.error, /broken viewport/)
    assert.equal(notifications, 1)
    fail = false
    await ctx.layer.source.loadBlocks([{ blockLayer: 0, x: 0, y: 0, displayLayer: 0 }], new AbortController().signal)
    assert.equal(first.error, null)
    assert.equal(notifications, 2)
    node.context.__cleanup.topology()
    node.context.__cleanup.topology()
    assert.equal(ctx.counts.removed, 1)
    assert.equal(observedSignal.aborted, true)
})

test('closing a pending grid prevents a late layer mount and permits a fresh session', async () => {
    const ctx = sessionDependencies()
    const pending = deferred()
    let calls = 0
    ctx.dependencies['../api/grid'] = {
        getGridDisplayMeta: () => ++calls === 1 ? pending.promise : Promise.resolve(ctx.meta),
    }
    const module = load('template/grid/gridDisplaySession.ts', ctx.dependencies)
    const node = { nodeInfo: 'grid' }
    const first = module.getGridDisplay(node, ctx.map)
    const rejected = assert.rejects(first.promise, { name: 'AbortError' })
    node.context.__cleanup.topology()
    const second = module.getGridDisplay(node, ctx.map)
    pending.resolve(ctx.meta)
    await rejected
    await second.promise
    assert.equal(ctx.counts.created, 1)
    assert.equal(module.getGridDisplay(node, ctx.map), second)
    second.dispose()
})

test('patch same-mode reads share one PatchCore and pending node close releases a late lock', async () => {
    const ctx = sessionDependencies()
    const link = deferred()
    ctx.dependencies['@/core/grid/patchCore'] = { default: class { constructor() { ctx.counts.core++ } } }
    // Mark CommonJS interop objects so the real default import is the test boundary class.
    ctx.dependencies['@/core/grid/patchCore'].__esModule = true
    ctx.dependencies['@/core/util/boundingBox2D'] = { boundingBox2D: (...bounds) => bounds }
    ctx.dependencies['@/template/api/node'] = {
        linkNode: async (_tag, nodeInfo, access) => { ctx.counts.link++; return nodeInfo === 'pending-patch' ? link.promise : { lock_id: `${access}-lock` } },
        unlinkNode: async () => { ctx.counts.unlink++; return { success: true, message: '' } },
    }
    ctx.dependencies['@/template/api/patch'] = { getPatchMeta: async () => ctx.meta }
    const module = load('components/gridDisplay/patchDisplaySession.ts', ctx.dependencies)
    const node = { nodeInfo: 'patch', lockId: 'held', mountParams: ctx.meta }
    const one = module.getPatchDisplay(node, ctx.map, 'r')
    assert.equal(module.getPatchDisplay(node, ctx.map, 'r'), one)
    const display = await one
    assert.equal(ctx.counts.core, 1)
    assert.equal(display.patchCore, ctx.layer.patchCore)
    node.context.__cleanup.topology()
    node.context.__cleanup.topology()
    assert.equal(ctx.counts.removed, 1)
    const pendingNode = { nodeInfo: 'pending-patch', lockId: null }
    const pending = module.getPatchDisplay(pendingNode, ctx.map, 'r')
    const rejected = assert.rejects(pending, { name: 'AbortError' })
    pendingNode.context.__cleanup.topology()
    link.resolve({ lock_id: 'late-lock' })
    await rejected
    assert.equal(ctx.counts.unlink, 2)
    assert.equal(pendingNode.lockId, null)
})

test('inspector renders original IDs, all four sides, one-to-many neighbors and edge IDs in both languages', () => {
    const cell = { id: 91, bounds: [0, 0, 2, 2], level: 2, elevation: 3.5, landClass: 7 }
    for (const language of ['en-US', 'zh-CN']) {
        const translation = load('i18n/gridDisplay.ts', {}, { navigator: { language } })
        const Inspector = load('components/gridDisplay/GridInspector.tsx', { '@/i18n/gridDisplay': translation }).default
        const html = renderToStaticMarkup(React.createElement(Inspector, { attributes: ['level', 'elevation', 'landClass'], inspection: {
            cell, neighbors: [
                { side: 'east', cell: { ...cell, id: 92 }, edgeIds: [4, 5] },
                { side: 'east', cell: { ...cell, id: 93 }, edgeIds: [6] },
            ],
        } }))
        for (const value of ['91', '92', '93', '4, 5', '3.5']) assert.ok(html.includes(value))
        for (const side of ['west', 'east', 'north', 'south']) assert.ok(html.includes(translation.gridDisplayI18n.t(side)))
        assert.ok(html.includes(translation.gridDisplayI18n.t('edges')))
    }
})

test('display statistics skip identical notifications and remove their listener', () => {
    const effects = []
    const updates = []
    let listener
    let removed = false
    let stats = { gpuBytes: 100, visibleChunks: 1, visibleCells: 5, fieldSamples: 2, fieldMode: true, ready: true }
    let stateIndex = 0
    const layer = {
        attribute: 'level', paletteColorList: new Uint8Array(256 * 3),
        getDisplayStats: () => stats,
        addDisplayStatsListener: callback => { listener = callback; return () => { removed = true } },
    }
    const Panel = load('components/gridDisplay/GridDisplayPanel.tsx', {
        '@/core/grid/displayColors': colorContract,
        '@/core/grid/displayMath': mathContract,
        react: {
            useEffect: effect => effects.push(effect),
            useState: initial => { const index = stateIndex++; return [typeof initial === 'function' ? initial() : initial, value => updates.push({ index, value })] },
        },
        '@/i18n/gridDisplay': { useGridDisplayTranslation: () => ({ t: key => key }) },
        './useGridInspection': { useGridInspection: () => ({ inspection: null, loading: false, error: null }) },
        './GridInspector': { __esModule: true, default: () => null },
    }).default
    Panel({ map: {}, layer, attributes: ['level'], gridInfo: [[1, 1]] })
    const cleanup = effects[0]()
    assert.equal(updates.length, 1)
    for (let frame = 0; frame < 100; frame++) listener()
    assert.equal(updates.length, 1)
    stats = { ...stats, gpuBytes: 200 }
    listener()
    assert.equal(updates.length, 2)
    assert.equal(updates[1].value.gpuBytes, 200)
    cleanup()
    assert.equal(removed, true)
})

test('inspection ignores out-of-order and post-unmount responses and unbinds map clicks', async () => {
    const effects = []
    const states = []
    const updates = []
    let stateIndex = 0
    const hook = load('components/gridDisplay/useGridInspection.ts', {
        react: {
            useEffect: effect => effects.push(effect),
            useState: initial => {
                const index = stateIndex++
                states[index] = initial
                return [initial, value => { states[index] = value; updates.push(index) }]
            },
        },
        '@/i18n/gridDisplay': i18n,
    }).useGridInspection
    const map = new TestMap()
    const requests = [deferred(), deferred(), deferred()]
    let request = 0
    hook(map, { inspectAt: () => requests[request++].promise }, true)
    const cleanup = effects[0]()
    const click = [...map.handlers.get('click')][0]
    const first = click({ point: { x: 1, y: 2 } })
    const second = click({ point: { x: 3, y: 4 } })
    requests[1].resolve({ cell: { id: 2 }, neighbors: [] })
    await second
    requests[0].resolve({ cell: { id: 1 }, neighbors: [] })
    await first
    assert.equal(states[0].cell.id, 2)
    const last = click({ point: { x: 5, y: 6 } })
    cleanup()
    assert.equal(map.listenerCount(), 0)
    const before = updates.length
    requests[2].resolve({ cell: { id: 3 }, neighbors: [] })
    await last
    assert.equal(updates.length, before)
})


test('display bounds handle zero coordinates, real projections, and invalid results', async () => {
    const bounds = load('components/gridDisplay/displayBounds.ts', {
        '@/i18n/gridDisplay': i18n,
        '@/template/api/proj': { getProj4Defs: async () => '+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +wktext +no_defs' },
    }).displayBoundsOn4326
    const identity = await bounds([0, 0, 1, 1], 4326)
    assert.equal(identity.join(','), '0,0,1,1')
    const projected = await bounds([0, 0, 111319.49079327357, 111325.1428663851], 3857)
    assert.ok(Math.abs(projected[0]) < 1e-10 && Math.abs(projected[1]) < 1e-10)
    assert.ok(Math.abs(projected[2] - 1) < 1e-10 && Math.abs(projected[3] - 1) < 1e-10)
    await assert.rejects(bounds([0, 0, Infinity, 1], 4326), /Unable to transform/)
    await assert.rejects(bounds([1, 0, 0, 1], 4326), /Unable to transform/)
})


function patchAccessContext(linkOverride, unlinkOverride) {
    const ctx = sessionDependencies()
    const events = []
    const cores = []
    ctx.dependencies['@/core/grid/patchCore'] = { __esModule: true, default: class {
        constructor(context) { this.context = context; cores.push(this) }
    } }
    ctx.dependencies['@/core/util/boundingBox2D'] = { boundingBox2D: (...bounds) => bounds }
    ctx.dependencies['@/template/api/node'] = {
        linkNode: async (_tag, nodeInfo, access) => {
            events.push(`link:${access}`)
            return linkOverride ? linkOverride(nodeInfo, access) : { lock_id: `${access}-${events.length}` }
        },
        unlinkNode: async (nodeInfo, lockId) => {
            events.push(`unlink:${lockId}`)
            return unlinkOverride ? unlinkOverride(nodeInfo, lockId) : { success: true, message: '' }
        },
    }
    ctx.dependencies['@/template/api/patch'] = { getPatchMeta: async () => ctx.meta }
    const { getPatchDisplay } = load('components/gridDisplay/patchDisplaySession.ts', ctx.dependencies)
    return { ...ctx, events, cores, getPatchDisplay }
}

test('ready read session upgrades to a new write lock/core, then Check reuses write access', async () => {
    const ctx = patchAccessContext()
    const node = { nodeInfo: 'patch', lockId: null, mountParams: ctx.meta }
    const readPromise = ctx.getPatchDisplay(node, ctx.map, 'r')
    const read = await readPromise
    assert.equal(read.patchCore.context.lockId, 'r-1')
    const writePromise = ctx.getPatchDisplay(node, ctx.map, 'w')
    assert.notEqual(writePromise, readPromise)
    const write = await writePromise
    assert.notEqual(write.patchCore, read.patchCore)
    assert.equal(write.patchCore.context.lockId, 'w-3')
    assert.deepEqual(ctx.events, ['link:r', 'unlink:r-1', 'link:w'])
    assert.equal(ctx.getPatchDisplay(node, ctx.map, 'r'), writePromise)
    assert.equal(ctx.getPatchDisplay(node, ctx.map, 'w'), writePromise)
    assert.equal(ctx.cores.length, 2)
    assert.equal(ctx.counts.removed, 1)
    node.context.__cleanup.topology()
})

test('pending read acquisition is released before requesting write access', async () => {
    const pending = deferred()
    const ctx = patchAccessContext((_node, access) => access === 'r' ? pending.promise : { lock_id: 'write-lock' })
    const node = { nodeInfo: 'patch', lockId: null, mountParams: ctx.meta }
    const read = ctx.getPatchDisplay(node, ctx.map, 'r')
    const canceled = assert.rejects(read, { name: 'AbortError' })
    const write = ctx.getPatchDisplay(node, ctx.map, 'w')
    assert.deepEqual(ctx.events, ['link:r'])
    pending.resolve({ lock_id: 'late-read' })
    await canceled
    const display = await write
    assert.deepEqual(ctx.events, ['link:r', 'unlink:late-read', 'link:w'])
    assert.equal(display.patchCore.context.lockId, 'write-lock')
    assert.equal(ctx.cores.length, 1)
    node.context.__cleanup.topology()
})

test('unknown menu lock is normally unlinked before editor write acquisition', async () => {
    const ctx = patchAccessContext()
    const node = { nodeInfo: 'patch', lockId: 'menu-read', mountParams: ctx.meta }
    const display = await ctx.getPatchDisplay(node, ctx.map, 'w')
    assert.deepEqual(ctx.events, ['unlink:menu-read', 'link:w'])
    assert.equal(display.patchCore.context.lockId, 'w-2')
    node.context.__cleanup.topology()
})

test('failed unlink rejects access upgrade, preserves tracked old lock and allows explicit retry', async () => {
    let fail = true
    const ctx = patchAccessContext(undefined, () => ({ success: !fail, message: 'release denied' }))
    const node = { nodeInfo: 'patch', lockId: null, mountParams: ctx.meta }
    await ctx.getPatchDisplay(node, ctx.map, 'r')
    await assert.rejects(ctx.getPatchDisplay(node, ctx.map, 'w'), /release denied/)
    assert.deepEqual(ctx.events, ['link:r', 'unlink:r-1'])
    assert.equal(node.lockId, 'r-1')
    assert.equal(ctx.cores.length, 1)
    fail = false
    const display = await ctx.getPatchDisplay(node, ctx.map, 'w')
    assert.deepEqual(ctx.events, ['link:r', 'unlink:r-1', 'unlink:r-1', 'link:w'])
    assert.equal(display.patchCore.context.lockId, 'w-4')
    node.context.__cleanup.topology()
})

test('node close during read-lock release prevents the queued write acquisition', async () => {
    const release = deferred()
    const started = deferred()
    const ctx = patchAccessContext(undefined, () => { started.resolve(); return release.promise })
    const node = { nodeInfo: 'patch', lockId: null, mountParams: ctx.meta }
    await ctx.getPatchDisplay(node, ctx.map, 'r')
    const write = ctx.getPatchDisplay(node, ctx.map, 'w')
    const canceled = assert.rejects(write, { name: 'AbortError' })
    await started.promise
    assert.equal(node.lockId, null)
    node.context.__cleanup.topology()
    release.resolve({ success: true, message: '' })
    await canceled
    assert.deepEqual(ctx.events, ['link:r', 'unlink:r-1'])
    assert.equal(ctx.cores.length, 1)
})

function renderLegend(attribute, props = {}, colors = colorContract, language = 'en-US') {
    const translation = load('i18n/gridDisplay.ts', {}, { navigator: { language } })
    const palette = new Uint8Array(256 * 3)
    palette.set([12, 34, 56], 3)
    palette.set([90, 91, 92], 255 * 3)
    const Panel = load('components/gridDisplay/GridDisplayPanel.tsx', {
        '@/core/grid/displayColors': colors,
        '@/core/grid/displayMath': mathContract,
        react: { useEffect: () => {}, useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}] },
        '@/i18n/gridDisplay': { useGridDisplayTranslation: () => ({ t: translation.gridDisplayI18n.t.bind(translation.gridDisplayI18n) }) },
        './useGridInspection': { useGridInspection: () => ({ inspection: null, loading: false, error: null }) },
        './GridInspector': { __esModule: true, default: () => null },
    }).default
    return renderToStaticMarkup(Panel({ map: {}, layer: {
        attribute, paletteColorList: palette,
        getDisplayStats: () => ({ gpuBytes: 1, visibleChunks: 1, visibleCells: 1, fieldSamples: 1, fieldMode: true, ready: true }),
    }, attributes: ['level', 'elevation', 'landClass'], gridInfo: [[2, 2]], ...props }))
}

test('land-class legend lists only metadata categories with original IDs and modulo-256 palette colors', () => {
    for (const language of ['en-US', 'zh-CN']) {
        const html = renderLegend('landClass', { landClasses: [-1, 257] }, undefined, language)
        assert.ok(html.includes('rgb(90, 91, 92)'))
        assert.ok(html.includes('rgb(12, 34, 56)'))
        assert.ok(html.includes(language === 'en-US' ? '>Class -1<' : '>类别 -1<'))
        assert.ok(html.includes(language === 'en-US' ? '>Class 257<' : '>类别 257<'))
        assert.ok(!html.includes('>Class 1<') && !html.includes('>类别 1<'))
    }
})

test('elevation legend consumes shared endpoints/function, including zero-width ranges', () => {
    let sampled
    const html = renderLegend('elevation', { elevationRange: [-10, 30] }, {
        ...colorContract, elevationColor: (value, range) => { sampled = { value, range }; return [0.23, 0.32, 0.41] },
    })
    assert.equal(sampled.value, 10)
    assert.equal(sampled.range.join(','), '-10,30')
    const rgb = color => `rgb(${color.map(channel => channel * 255).join(', ')})`
    assert.ok(html.includes(`linear-gradient(to right, ${rgb(colorContract.ELEVATION_LOW_COLOR)}, ${rgb([0.23, 0.32, 0.41])}, ${rgb(colorContract.ELEVATION_HIGH_COLOR)})`))
    const zero = renderLegend('elevation', { elevationRange: [5, 5] }, {
        ...colorContract, elevationColor: () => colorContract.ELEVATION_LOW_COLOR,
    })
    const low = rgb(colorContract.ELEVATION_LOW_COLOR)
    assert.ok(zero.includes(`linear-gradient(to right, ${low}, ${low}, ${low})`))
    assert.ok(!zero.includes(rgb(colorContract.ELEVATION_HIGH_COLOR)))
})

test('outline legend multiplies white by the shared darkening constant', () => {
    const html = renderLegend('level')
    for (const coverage of [0.234375, 0.4375, 1]) {
        const value = 255 * (1 - colorContract.OUTLINE_DARKENING * coverage)
        assert.ok(html.includes(`rgb(${value}, ${value}, ${value})`))
    }
})
