import TopologyLayer from '../src/views/mapView/topology/TopologyLayer'
import PatchCore from '../src/core/grid/patchCore'
import DisplayIndex from '../src/core/grid/displayIndex'
import type Dispatcher from '../src/core/message/dispatcher'
import BoundingBox2D from '../src/core/util/boundingBox2D'
import type { Bounds, GridDisplayView, ReadOnlyGridSource } from '../src/core/grid/displayTypes'

const canvas = document.querySelector<HTMLCanvasElement>('#gl')!
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false })!
const result = document.querySelector<HTMLElement>('#result')!
const EARTH = 2 * Math.PI * 6378137
const SIZE = 512
const SPAN = 8000
const checks: string[] = []
const errors: string[] = []
const measurements: Record<string, unknown> = {}

function check(name: string, condition: unknown, detail?: unknown): void {
    if (condition) checks.push(name)
    else errors.push(`${name}: ${JSON.stringify(detail)}`)
}
function near(a: number, b: number, tolerance = 3): boolean { return Math.abs(a - b) <= tolerance }
function tick(): Promise<void> { return new Promise(resolve => setTimeout(resolve, 0)) }
function deferred<T>() {
    let resolve!: (value: T) => void
    return { promise: new Promise<T>(r => { resolve = r }), resolve }
}

class PublicCamera {
    centerX = 0
    centerY = 0
    listeners = new Map<string, Set<() => void>>()
    triggerRepaint() {}
    isMoving() { return false }
    getCanvas() { return canvas }
    getContainer() { return canvas.parentElement! }
    on(event: string, listener: () => void) {
        const set = this.listeners.get(event) ?? new Set<() => void>()
        set.add(listener)
        this.listeners.set(event, set)
    }
    off(event: string, listener: () => void) { this.listeners.get(event)?.delete(listener) }
    emit(event: string) { for (const listener of this.listeners.get(event) ?? []) listener() }
    project(lngLat: [number, number]) {
        const x = lngLat[0] * EARTH / 360
        const y = Math.log(Math.tan(Math.PI / 4 + lngLat[1] * Math.PI / 360)) * EARTH / (2 * Math.PI)
        return { x: SIZE / 2 + (x - this.centerX) * SIZE / SPAN, y: SIZE / 2 - (y - this.centerY) * SIZE / SPAN }
    }
    unproject(point: [number, number]) {
        const x = this.centerX + (point[0] - SIZE / 2) * SPAN / SIZE
        const y = this.centerY - (point[1] - SIZE / 2) * SPAN / SIZE
        return { lng: x / EARTH * 360, lat: (2 * Math.atan(Math.exp(y * 2 * Math.PI / EARTH)) - Math.PI / 2) * 180 / Math.PI }
    }
    matrix(): number[] {
        const scale = 2 * EARTH / SPAN
        const x = 0.5 + this.centerX / EARTH
        const y = 0.5 - this.centerY / EARTH
        return [scale, 0, 0, 0, 0, -scale, 0, 0, 0, 0, 1, 0, -scale * x, scale * y, 0, 1]
    }
}

const view: GridDisplayView = { cellCount: 102, chunks: [{
    key: 'center', bounds: [-2000, 0, 2000, 1000],
    cells: [{ id: 7, bounds: [-2000, 0, -1000, 1000], level: 0, elevation: 40, landClass: 1 }],
    fields: [
        { bounds: [0, 0, 15.625, 15.625], occupiedFraction: 0.5, minCellSize: 2, level: 1, elevation: 40, landClass: 1 },
        { bounds: [15.625, 0, 31.25, 15.625], occupiedFraction: 1, minCellSize: 2, level: 1, elevation: 40, landClass: 1 },
    ],
}] }
const farView: GridDisplayView = { cellCount: 102, chunks: [{
    key: 'far', bounds: [8000, 0, 9000, 1000],
    cells: [{ id: 8, bounds: [8000, 0, 9000, 1000], level: 0, elevation: 20, landClass: 1 }], fields: [],
}] }

function pixel(x: number, y: number): number[] {
    const data = new Uint8Array(4)
    gl.readPixels(x, SIZE - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data)
    return Array.from(data)
}
function draw(layer: TopologyLayer, camera: PublicCamera) {
    gl.viewport(0, 0, SIZE, SIZE)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    layer.render(gl, camera.matrix())
    gl.finish()
}

async function main() {
    if (!gl) throw new Error('WebGL2 context unavailable')
    const camera = new PublicCamera()
    const layer = new TopologyLayer(camera as never)
    const inspection = { cell: view.chunks[0].cells[0], neighbors: [] }
    const inspectCalls: [number, number][] = []
    const requests: { bounds: Bounds, signal: AbortSignal, resolve: (value: GridDisplayView) => void }[] = []
    const cameraQueries: { bounds: Bounds, metersPerPixel: number }[] = []
    let nextView: GridDisplayView | null = view
    const source: ReadOnlyGridSource = {
        meta: { epsg: 3857, bounds: [-2000, 0, 9000, 1000], grid_info: [[1000, 1000], [200, 200]],
            level_info: [{ width: 11, height: 1 }, { width: 55, height: 5 }], subdivide_rules: [[5, 5]],
            alignment_origin: [-2000, 0], cellCount: 102, attributes: ['level', 'elevation', 'landClass'], elevationRange: [0, 100], landClasses: [1] },
        loadView(bounds, metersPerPixel, signal) {
            cameraQueries.push({ bounds, metersPerPixel })
            if (nextView) { const value = nextView; nextView = null; return Promise.resolve(value) }
            const request = deferred<GridDisplayView>()
            requests.push({ bounds, signal, resolve: request.resolve })
            return request.promise
        },
        inspect(x, y) { inspectCalls.push([x, y]); return Promise.resolve(inspection) },
    }
    const statsEvents: number[] = []
    const unsubscribe = layer.addDisplayStatsListener(stats => statsEvents.push(stats.gpuBytes))
    await layer.initialize(camera as never, gl)
    await layer.setReadOnlySource(source)
    draw(layer, camera)
    measurements.cameraScale = cameraQueries[0].metersPerPixel
    const drawError = gl.getError()
    check('real shader compiles, links, and draws without GL error', drawError === gl.NO_ERROR, drawError)
    check('public camera supplies exact grid bounds and scale', cameraQueries.length === 1
        && cameraQueries[0].bounds.every((v, i) => near(v, [-4000, -4000, 4000, 4000][i], 0.01))
        && near(cameraQueries[0].metersPerPixel, SPAN / SIZE, 0.01), cameraQueries)
    const half = pixel(256, 255), full = pixel(257, 255), hole = pixel(224, 224), real = pixel(160, 224)
    check('half occupied field has alpha about one half', near(half[3], 128), { half })
    check('full field has saturated alpha', full[3] === 255, { full })
    check('half occupied color is premultiplied once', half.slice(0, 3).every((v, i) => near(v, full[i] * 0.5, 4)), { half, full })
    check('hole stays transparent', hole[3] === 0, { hole })
    check('original cell renders', real[3] === 255, { real })
    const palette = Array.from(layer.paletteColorList.slice(3, 6))
    check('one-pixel field uses saturated density without invented outline', full.slice(0, 3).every((v, i) => near(v, palette[i] * 0.35, 3)), { full, palette })
    const stats = layer.getDisplayStats()
    check('GPU bytes equal three instance records plus palette', stats.gpuBytes === 3 * 64 + 768, stats)
    check('stats distinguish original cells from field samples', stats.visibleChunks === 1 && stats.visibleCells === 1 && stats.fieldSamples === 2 && stats.fieldMode && stats.ready, stats)
    const inspected = await layer.inspectAt([288, 224])
    check('inspect delegates original point to source', inspected === inspection && inspectCalls.length === 1 && near(inspectCalls[0][0], 500, 0.01) && near(inspectCalls[0][1], 500, 0.01), inspectCalls)
    const originalBufferData = gl.bufferData.bind(gl)
    let uploads = 0
    gl.bufferData = ((...args: Parameters<typeof gl.bufferData>) => { uploads++; originalBufferData(...args) }) as typeof gl.bufferData
    camera.centerX = 1
    camera.emit('move')
    camera.emit('moveend')
    await tick()
    requests[requests.length - 1]!.resolve(JSON.parse(JSON.stringify(view)))
    await tick()
    check('unchanged JSON chunks survive camera pan without buffer upload', uploads === 0, uploads)
    gl.bufferData = originalBufferData
    camera.centerX = 0
    layer.hide()
    check('hide frees all chunk allocations but retains palette', layer.getDisplayStats().gpuBytes === 768 && layer.getDisplayStats().visibleChunks === 0, layer.getDisplayStats())
    layer.show()
    await tick()
    const shown = requests[requests.length - 1]!
    shown.resolve(view)
    await tick()
    check('show restores visible chunk', layer.getDisplayStats().gpuBytes === 960, layer.getDisplayStats())
    camera.centerX = 8500
    camera.emit('move')
    camera.emit('moveend')
    await tick()
    check('pan immediately evicts offscreen chunk', layer.getDisplayStats().gpuBytes === 768, layer.getDisplayStats())
    const stale = requests[requests.length - 1]!
    camera.centerX = 8600
    camera.emit('move')
    camera.emit('moveend')
    await tick()
    check('new camera coalesces behind one uncanceled read request', !stale.signal.aborted && requests[requests.length - 1] === stale)
    stale.resolve(view)
    await tick()
    const newest = requests[requests.length - 1]!
    check('completion starts one latest-camera read and keeps offscreen data evicted', !newest.signal.aborted && stale !== newest && layer.getDisplayStats().visibleChunks === 0)
    newest.resolve(farView)
    await tick()
    check('latest camera reaches ready with the correct visible chunk', layer.isReady && layer.getDisplayStats().gpuBytes === 832 && layer.getDisplayStats().visibleCells === 1, layer.getDisplayStats())
    unsubscribe()
    const eventCount = statsEvents.length
    layer.hide()
    check('unsubscribed listener receives no changes', statsEvents.length === eventCount)
    layer.remove(camera as never, gl)
    check('remove releases palette and all buffers', layer.getDisplayStats().gpuBytes === 0 && layer.getDisplayStats().visibleChunks === 0, layer.getDisplayStats())
    check('remove unregisters camera listeners', [...camera.listeners.values()].every(set => set.size === 0))

    camera.centerX = 0
    const editLayer = new TopologyLayer(camera as never)
    await editLayer.initialize(camera as never, gl)
    const dispatcher = {
        syncApiBaseUrl(callback: () => void) { callback() },
        actor: { send(type: string, data: { levels: Uint8Array; globalIds: Uint32Array }, callback: (error: null, result?: unknown) => void) {
            if (type === 'subdivideCells') {
                const children = core.getChildren(data.levels[0], data.globalIds[0])!
                callback(null, { levels: new Uint8Array(children.length).fill(data.levels[0] + 1), globalIds: new Uint32Array(children) })
            } else if (type === 'mergeCells') {
                const level = data.levels[0]
                const width = core.levelInfos[level].width
                const rule = core.context.rules[level - 1]
                const parentId = Math.floor(Math.floor(data.globalIds[0] / width) / rule[1]) * core.levelInfos[level - 1].width + Math.floor((data.globalIds[0] % width) / rule[0])
                callback(null, { levels: new Uint8Array([level - 1]), globalIds: new Uint32Array([parentId]) })
            }
            else callback(null)
        } }, remove() {},
    } as unknown as Dispatcher
    const core = new PatchCore({ nodeInfo: 'fixture', lockId: 'lock', srcCS: 'EPSG:3857', targetCS: 'EPSG:4326', bBox: new BoundingBox2D(-4000, -4000, 4000, 4000), rules: [[2, 2], [2, 2], [2, 2]] }, { dispatcher })
    core.updateMultiCellRenderInfo({ levels: new Uint8Array([1, 1, 1, 1]), globalIds: new Uint32Array([0, 1, 2, 3]) })
    core.init = callback => callback?.()
    editLayer.patchCore = core
    await tick()
    editLayer.executePickCells('brush', true, [64, 448])
    check('patch brush selects original storage id', editLayer.hitBuffer.all.join(',') === '0', editLayer.hitBuffer.all)
    editLayer.executeSubdivideCells()
    await tick()
    check('subdivision preserves editor selection and loaded-cell growth', core.cellNum === 7 && editLayer.hitBuffer.size === 4, { count: core.cellNum, selected: editLayer.hitBuffer.all })
    const hanging = await editLayer.inspectAt([320, 384])
    check('patch inspect returns real hanging neighbors at current storage ids', hanging.cell?.level === 1 && hanging.neighbors.filter(n => n.side === 'west').length === 2 && hanging.neighbors.every(n => n.edgeIds.length > 0), hanging)
    editLayer.executeDeleteCells()
    await tick()
    check('delete marks selected real cells and retains sparse selection', editLayer.hitBuffer.all.every(id => core.isDeleted(id)) && editLayer.hitBuffer.size === 4)
    editLayer.executeRecoverCells()
    await tick()
    check('restore clears real deletion flags', editLayer.hitBuffer.all.every(id => !core.isDeleted(id)) && editLayer.hitBuffer.size === 4)
    editLayer.executeMergeCells()
    await tick()
    check('merge restores parent and storage map after tail compaction', core.cellNum === 4 && core.getStorageId(1, 0) !== undefined && editLayer.hitBuffer.size === 1, { count: core.cellNum, selected: editLayer.hitBuffer.all })
    editLayer.executeClearSelection()
    editLayer.executePickCells('box', true, [0, 256], [256, 512])
    check('box selection includes only positive-area original cells', editLayer.hitBuffer.size === 1 && core.getInfoByStorageId(editLayer.hitBuffer.all[0])[1] === 0, editLayer.hitBuffer.all)
    editLayer.executePickAllCells()
    check('pick all selects loaded cells without capacity allocation', editLayer.hitBuffer.size === 4)
    const pendingFrame = editLayer.waitForBenchmarkRenderFrame(1000)
    draw(editLayer, camera)
    check('benchmark frame reports original total cells', (await pendingFrame).cellCount === 4)
    for (const operation of ['pick', 'subdivide', 'merge', 'delete', 'recover'] as const) {
        const task = editLayer.runBenchmarkEditOperation(operation, 17)
        await tick()
        draw(editLayer, camera)
        const report = await task
        check(`benchmark ${operation} completes with original-cell metadata`, report.operation === operation && report.cellCountAfter === core.cellNum && report.selectedCellCount > 0, report)
    }
    editLayer.remove(camera as never, gl)
    check('editable cleanup releases all GPU bytes', editLayer.getDisplayStats().gpuBytes === 0)

    const densityStats: { originals: number; fields: number; gpuBytes: number }[] = []
    for (const side of [128, 256]) {
        const pitch = 1000 / side
        const index = new DisplayIndex([0, 0, 1000, 1000], { grid_info: [[1000, 1000], [pitch, pitch]], alignment_origin: [0, 0] })
        let id = 1
        for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
            if ((x + y) % 2 === 0) index.upsert({ id: id++, bounds: [x * pitch, y * pitch, (x + 1) * pitch, (y + 1) * pitch], level: 1, elevation: 0, landClass: 0 })
        }
        const densityLayer = new TopologyLayer(camera as never)
        await densityLayer.initialize(camera as never, gl)
        await densityLayer.setReadOnlySource({
            meta: { epsg: 3857, bounds: [0, 0, 1000, 1000], grid_info: [[1000, 1000], [pitch, pitch]], level_info: [{ width: 1, height: 1 }, { width: side, height: side }], subdivide_rules: [[side, side]], alignment_origin: [0, 0], cellCount: id - 1, attributes: ['level'], elevationRange: [0, 0], landClasses: [0] },
            loadView(bounds, scale) { return Promise.resolve(index.query(bounds, scale)) },
            inspect(x, y) { return Promise.resolve(index.inspect(x, y)) },
        })
        draw(densityLayer, camera)
        const stats = densityLayer.getDisplayStats()
        check(`checkerboard ${id - 1} displays half occupied opacity`, near(pixel(288, 224)[3], 128), pixel(288, 224))
        densityStats.push({ originals: id - 1, fields: stats.fieldSamples, gpuBytes: stats.gpuBytes })
        check(`checkerboard ${id - 1} originals draws only field samples`, stats.visibleCells === 0 && stats.fieldSamples === 4096 && stats.gpuBytes === 4096 * 64 + 768, stats)
        densityLayer.remove(camera as never, gl)
    }
    measurements.checkerboards = densityStats
    check('quadrupling fine originals preserves viewport GPU allocation', densityStats[1].originals === densityStats[0].originals * 4 && densityStats[1].gpuBytes === densityStats[0].gpuBytes && densityStats[1].fields === densityStats[0].fields, densityStats)

    // Simulate loss while the shader fetch is pending, then let the new context
    // initialization finish before the stale fetch. Only one GPU set may survive.
    const realFetch = window.fetch.bind(window)
    const pendingShader = deferred<Response>()
    let firstShader = true
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith('/shaders/patch/display.glsl') && firstShader) { firstShader = false; return pendingShader.promise }
        return realFetch(input, init)
    }) as typeof window.fetch
    const createProgram = gl.createProgram.bind(gl)
    let programsCreated = 0
    gl.createProgram = () => { programsCreated++; return createProgram() }
    const restoringLayer = new TopologyLayer(camera as never)
    const oldInitialization = restoringLayer.initialize(camera as never, gl)
    await tick()
    canvas.dispatchEvent(new Event('webglcontextlost'))
    canvas.dispatchEvent(new Event('webglcontextrestored'))
    await restoringLayer.whenInitialized()
    pendingShader.resolve(await realFetch('/shaders/patch/display.glsl'))
    await oldInitialization
    check('stale shader fetch cannot allocate or replace restored GPU resources', programsCreated === 1 && restoringLayer.initialized && restoringLayer.getDisplayStats().gpuBytes === 768, { programsCreated, stats: restoringLayer.getDisplayStats() })
    restoringLayer.remove(camera as never, gl)
    gl.createProgram = createProgram
    window.fetch = realFetch


}

main().catch(error => errors.push(error instanceof Error ? error.stack ?? error.message : String(error))).finally(() => {
    result.textContent = JSON.stringify({ ok: errors.length === 0, checks, errors, measurements, renderer: gl?.getParameter(gl.RENDERER), version: gl?.getParameter(gl.VERSION) })
    document.documentElement.dataset.done = 'true'
})
