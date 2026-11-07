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
const translations = load('i18n/gridDisplay.ts')
const appI18n = load('i18n/index.ts', { './gridDisplay': translations }).default
const i18n = { ...translations, useGridDisplayTranslation: () => ({ t: appI18n.getFixedT(null, 'gridDisplay') }) }
function inLanguage(language) {
    void appI18n.changeLanguage(language)
    return i18n
}

// These boundary values test UI wiring; this does not substitute for engine integration.
const colorContract = {
    ELEVATION_LOW_COLOR: [0.16, 0.40, 0.46],
    ELEVATION_HIGH_COLOR: [0.87, 0.76, 0.52],
    elevationColor: () => [0.23, 0.32, 0.41],
}
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

test('application i18n shares the default instance, namespace and identical language keys', () => {
    assert.equal(appI18n === require('i18next'), true)
    assert.equal(appI18n.isInitialized, true)
    assert.deepEqual(Object.keys(translations.gridDisplayResources.en).sort(), Object.keys(translations.gridDisplayResources.zh).sort())
    assert.equal(translations.gridDisplayI18n, undefined)
    let namespace
    const wrapper = load('i18n/gridDisplay.ts', { 'react-i18next': { useTranslation: value => { namespace = value; return { t: appI18n.getFixedT(null, value) } } } })
    wrapper.useGridDisplayTranslation()
    assert.equal(namespace, 'gridDisplay')
    for (const language of ['en', 'zh']) {
        inLanguage(language)
        const message = appI18n.t('gridDisplay:httpError', { path: '/meta', status: 422, detail: ' corrupt topology' })
        assert.ok(message.includes('/meta') && message.includes('HTTP 422') && message.includes('corrupt topology'))
        for (const key of Object.keys(translations.gridDisplayResources[language])) {
            assert.equal(appI18n.exists(`gridDisplay:${key}`, { lng: language }), true)
        }
    }
    inLanguage('en')
    const entry = fs.readFileSync(path.resolve('src/main.tsx'), 'utf8')
    assert.ok(entry.includes("import './i18n'"))
})

function sessionDependencies() {
    const map = new TestMap()
    const meta = { revision: 'test', displayLayers: [], bounds: [0, 0, 10, 10], epsg: 4326, grid_info: [[1, 1]], subdivide_rules: [[2, 2]] }
    const counts = { created: 0, removed: 0, source: 0, core: 0, unregister: 0, link: 0, unlink: 0 }
    const layer = { addErrorListener(listener) { listener(null); return () => {} }, setReadOnlySource: async source => { layer.source = source; counts.source++ } }
    const manager = {
        getOrCreatePerPatchTopology: () => { counts.created++; return { clgId: 'layer', topologyLayer: layer } },
        ensureTopologyLayerInitialized: async () => {},
        removePerPatchTopology: () => { counts.removed++ },
    }
    const dependencies = {
        '@/components/gridDisplay/displayBounds': { displayBoundsOn4326: async () => [0, 0, 10, 10] },
        './displayBounds': { displayBoundsOn4326: async () => [0, 0, 10, 10] },
        '@/i18n/gridDisplay': i18n,
        '@/i18n': { __esModule: true, default: appI18n },
        '@/components/gridDisplay/mapReady': readiness,
        './mapReady': readiness,
        '@/views/mapView/layerOrderCoordinator': { layerOrderCoordinator: {
            register: () => {}, unregister: () => { counts.unregister++ },
        } },
        '@/views/mapView/topology/topologyLayerManager': manager,
    }
    return { map, meta, counts, layer, dependencies }
}

test('grid tabs share one source and cancel requests on node close', async () => {
    const ctx = sessionDependencies()
    let observedSignal
    ctx.dependencies['../api/grid'] = {
        getGridDisplayMeta: async () => ctx.meta,
        createGridDisplayBlockCache: () => ({ clear() {}, query: async (_blocks, signal) => {
            observedSignal = signal
            return { chunks: [], cellCount: 0 }
        } }),
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
    await ctx.layer.source.loadBlocks([{ blockLayer: 0, x: 0, y: 0, displayLayer: 0 }], new AbortController().signal)
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
        createGridDisplayBlockCache: () => ({ clear() {}, query: async () => ({ chunks: [], cellCount: 0 }) }),
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
        const translation = inLanguage(language)
        const Inspector = load('components/gridDisplay/GridInspector.tsx', { '@/i18n/gridDisplay': translation }).default
        const html = renderToStaticMarkup(React.createElement(Inspector, { attributes: ['level', 'elevation', 'landClass'], inspection: {
            cell, neighbors: [
                { side: 'east', cell: { ...cell, id: 92 }, edgeIds: [4, 5] },
                { side: 'east', cell: { ...cell, id: 93 }, edgeIds: [6] },
            ],
        } }))
        for (const value of ['91', '92', '93', '4, 5', '3.5']) assert.ok(html.includes(value))
        for (const side of ['west', 'east', 'north', 'south']) assert.ok(html.includes(appI18n.t(`gridDisplay:${side}`)))
        assert.ok(html.includes(appI18n.t('gridDisplay:edges')))
    }
})

// Keep effects and state observable while rendering the real component's markup.
function componentHarness(file, dependencies, props) {
    const states = []
    const effects = []
    let stateIndex = 0
    let mounted = false
    const Component = load(file, { ...dependencies, react: {
        useState: initial => {
            const index = stateIndex++
            if (!mounted) states[index] = typeof initial === 'function' ? initial() : initial
            return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
        },
        useEffect: effect => { if (!mounted) effects.push(effect) },
    } }).default
    return {
        render: () => {
            stateIndex = 0
            const html = renderToStaticMarkup(Component(props))
            mounted = true
            return html
        },
        mount: () => effects.map(effect => effect()).filter(Boolean),
    }
}

function panelDependencies() {
    return {
        '@/core/grid/displayColors': colorContract,
        '@/i18n/gridDisplay': i18n,
        './useGridInspection': { useGridInspection: () => ({ inspection: null, loading: false, error: null }) },
        './GridInspector': { __esModule: true, default: () => null },
    }
}

test('shared panel immediately renders the current viewport error, clears success and unsubscribes in both modes', () => {
    inLanguage('en')
    for (const attributes of [['level'], ['level', 'elevation', 'landClass']]) {
        let listener
        let removed = false
        const layer = {
            attribute: 'level', paletteColorList: new Uint8Array(768),
            addErrorListener: callback => { listener = callback; callback(new Error('existing viewport failure')); return () => { removed = true } },
        }
        const panel = componentHarness('components/gridDisplay/GridDisplayPanel.tsx', panelDependencies(), {
            map: {}, layer, attributes, gridInfo: [[1, 1]],
        })
        panel.render()
        const cleanups = panel.mount()
        let html = panel.render()
        assert.match(html, /role="alert"[^>]*>Unable to load viewport: existing viewport failure/)
        listener(null)
        html = panel.render()
        assert.ok(!html.includes('role="alert"') && !html.includes('existing viewport failure'))
        listener(new Error('next viewport failure'))
        assert.match(panel.render(), /Unable to load viewport: next viewport failure/)
        cleanups.forEach(cleanup => cleanup())
        assert.equal(removed, true)
    }
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
        '@/i18n': { __esModule: true, default: appI18n },
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
        '@/i18n': { __esModule: true, default: appI18n },
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
    const translation = inLanguage(language)
    const palette = new Uint8Array(256 * 3)
    palette.set([12, 34, 56], 3)
    palette.set([90, 91, 92], 255 * 3)
    const Panel = load('components/gridDisplay/GridDisplayPanel.tsx', {
        '@/core/grid/displayColors': colors,
        react: { useEffect: () => {}, useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}] },
        '@/i18n/gridDisplay': translation,
        './useGridInspection': { useGridInspection: () => ({ inspection: null, loading: false, error: null }) },
        './GridInspector': { __esModule: true, default: () => null },
    }).default
    return renderToStaticMarkup(Panel({ map: {}, layer: {
        attribute, paletteColorList: palette,
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

test('panel retains attributes and the color legend with a short outline hint', () => {
    for (const language of ['en', 'zh']) {
        const html = renderLegend('level', {}, undefined, language)
        const t = appI18n.getFixedT(language, 'gridDisplay')
        for (const key of ['attribute', 'level', 'elevation', 'landClass', 'legend', 'densityHint']) assert.ok(html.includes(t(key)))
        assert.ok(html.includes(t('levelSize', { level: 1, width: 2, height: 2 })))
        for (const forbidden of ['0.234375', '0.4375', 'CSS', 'GPU', 'visibleChunks', 'fieldSamples', 'coverage =', '覆盖率']) assert.ok(!html.includes(forbidden))
        assert.ok(!html.includes('<dl') && !html.includes('Field mode active') && !html.includes('场模式已启用'))
    }
})

test('patch inspector renders real coarse/fine neighbors without synthetic edge IDs', () => {
    for (const language of ['en', 'zh']) {
        inLanguage(language)
        const Inspector = load('components/gridDisplay/GridInspector.tsx', { '@/i18n/gridDisplay': i18n }).default
        const cell = { id: 91, bounds: [0, 0, 2, 2], level: 1, elevation: 0, landClass: 0 }
        const html = renderToStaticMarkup(React.createElement(Inspector, { attributes: ['level'], inspection: {
            cell, neighbors: [
                { side: 'east', cell: { ...cell, id: 92, level: 2, bounds: [2, 0, 3, 1] } },
                { side: 'east', cell: { ...cell, id: 93, level: 2, bounds: [2, 1, 3, 2] } },
                { side: 'north', cell: { ...cell, id: 94, level: 0, bounds: [0, 2, 4, 6] } },
            ],
        } }))
        for (const value of ['91', '92', '93', '94', '2, 0, 3, 1', '0, 2, 4, 6']) assert.ok(html.includes(value))
        assert.ok(!html.includes(appI18n.t('gridDisplay:edges')))
    }
})

function checkDependencies(session) {
    const passthrough = tag => ({ children, ...props }) => React.createElement(tag, props, children)
    return {
        '@/i18n/gridDisplay': i18n,
        'lucide-react': { MapPin: () => null, SquareMousePointer: () => null },
        '@/components/ui/button': { Button: passthrough('button') },
        '@/components/ui/avatar': { Avatar: passthrough('div'), AvatarFallback: passthrough('div') },
        '@/components/gridDisplay/GridDisplayPanel': { __esModule: true, default: props => React.createElement('p', null, JSON.stringify({
            gridInfo: props.gridInfo, elevationRange: props.elevationRange, landClasses: props.landClasses, attributes: props.attributes,
        })) },
        './gridDisplaySession': { getGridDisplay: () => session },
        '@/components/gridDisplay/patchDisplaySession': { getPatchDisplay: () => session.promise },
    }
}

const flush = () => new Promise(resolve => setImmediate(resolve))

test('revision notification reloads session.promise and metadata without moving the current camera', async () => {
    inLanguage('en')
    const old = { meta: { epsg: 4326, grid_info: [[2, 2]], elevationRange: [0, 10], landClasses: [7] }, boundsOn4326: [0, 0, 1, 1], topologyLayer: {} }
    const updated = { ...old, meta: { epsg: 3857, grid_info: [[4, 4]], elevationRange: [-5, 50], landClasses: [9, 12] } }
    const session = { promise: Promise.resolve(old), listeners: new Set() }
    let fits = 0
    const check = componentHarness('template/grid/gridCheck.tsx', checkDependencies(session), { node: { name: 'grid' }, context: { map: { fitBounds: () => fits++ } } })
    assert.match(check.render(), /Loading grid/)
    const cleanups = check.mount()
    await flush()
    assert.ok(check.render().includes('[0,10]'))
    const superseded = deferred()
    session.promise = superseded.promise
    session.listeners.forEach(listener => listener())
    session.promise = Promise.resolve(updated)
    session.listeners.forEach(listener => listener())
    await flush()
    const html = check.render()
    assert.ok(html.includes('3857') && html.includes('[-5,50]') && html.includes('[9,12]') && html.includes('[[4,4]]'))
    assert.ok(!html.includes('[0,10]'))
    superseded.resolve(old)
    await flush()
    assert.ok(check.render().includes('[-5,50]'))
    assert.equal(fits, 1)
    cleanups.forEach(cleanup => cleanup())
    assert.equal(session.listeners.size, 0)
})

test('initial grid and patch loading failures remain visible and late resolutions after unmount are ignored', async () => {
    inLanguage('en')
    for (const file of ['template/grid/gridCheck.tsx', 'template/patch/patchCheck.tsx']) {
        const pending = deferred()
        const session = { promise: pending.promise, listeners: new Set() }
        const check = componentHarness(file, checkDependencies(session), { node: { name: 'sample' }, context: { map: {} } })
        check.render()
        const cleanups = check.mount()
        pending.reject(new Error('initial load failed'))
        await flush()
        assert.match(check.render(), /role="alert"/)
        assert.match(check.render(), /Unable to load grid: initial load failed/)
        assert.match(check.render(), /Retry/)
        cleanups.forEach(cleanup => cleanup())
    }
    const pending = deferred()
    const session = { promise: pending.promise, listeners: new Set() }
    let fits = 0
    const check = componentHarness('template/grid/gridCheck.tsx', checkDependencies(session), { node: { name: 'grid' }, context: { map: { fitBounds: () => fits++ } } })
    check.render()
    check.mount().forEach(cleanup => cleanup())
    pending.resolve({ boundsOn4326: [0, 0, 1, 1] })
    await flush()
    assert.equal(fits, 0)
    assert.match(check.render(), /Loading grid/)
})
