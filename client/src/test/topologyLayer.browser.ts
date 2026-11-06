import { OUTLINE_DARKENING } from '../src/core/grid/displayColors'
import TopologyLayer from '../src/views/mapView/topology/TopologyLayer'
import PatchCore from '../src/core/grid/patchCore'
import DisplayIndex from '../src/core/grid/displayIndex'
import { displayLayer, displayLayers, nodeBounds, nodeRange } from '../src/core/grid/displayHierarchy'
import { DisplayBlockCache } from '../src/core/grid/displayBlockCache'
import type Dispatcher from '../src/core/message/dispatcher'
import BoundingBox2D from '../src/core/util/boundingBox2D'
import type { DisplayBlock, GridDisplayView, ReadOnlyGridSource } from '../src/core/grid/displayTypes'

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
async function until(condition: () => boolean): Promise<void> {
    const deadline = performance.now() + 5000
    while (!condition()) {
        if (performance.now() > deadline) throw new Error('Timed out waiting for display worker/lifecycle')
        await new Promise(resolve => setTimeout(resolve, 5))
    }
}
async function frame(): Promise<void> {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    await tick()
}
function deferred<T>() {
    let resolve!: (value: T) => void
    return { promise: new Promise<T>(r => { resolve = r }), resolve }
}

class PublicCamera {
    span = SPAN
    centerX = 0
    centerY = 0
    moving = false
    listeners = new Map<string, Set<() => void>>()
    triggerRepaint() {}
    isMoving() { return this.moving }
    getProjection() { return { name: 'mercator' } }
    getPitch() { return 0 }
    getBearing() { return 0 }
    getZoom() { return Math.log2(SIZE * EARTH / this.span / 512) }
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
        return { x: SIZE / 2 + (x - this.centerX) * SIZE / this.span, y: SIZE / 2 - (y - this.centerY) * SIZE / this.span }
    }
    unproject(point: [number, number]) {
        const x = this.centerX + (point[0] - SIZE / 2) * this.span / SIZE
        const y = this.centerY - (point[1] - SIZE / 2) * this.span / SIZE
        return { lng: x / EARTH * 360, lat: (2 * Math.atan(Math.exp(y * 2 * Math.PI / EARTH)) - Math.PI / 2) * 180 / Math.PI }
    }
    matrix(): number[] {
        const scale = 2 * EARTH / this.span
        const x = 0.5 + this.centerX / EARTH
        const y = 0.5 - this.centerY / EARTH
        return [scale, 0, 0, 0, 0, -scale, 0, 0, 0, 0, 1, 0, -scale * x, scale * y, 0, 1]
    }
}

const view: GridDisplayView = { cellCount: 102, chunks: [{
    key: 'center', bounds: [-2000, 0, 2000, 1000],
    cells: [{ id: 7, bounds: [-2000, 0, -1000, 1000], level: 0, elevation: 40, landClass: 1 }],
    fields: [
        { bounds: [0, 0, 32, 32], occupiedFraction: 0.5, minCellSize: 2, level: 1, elevation: 40, landClass: 1 },
        { bounds: [32, 0, 64, 32], occupiedFraction: 1, minCellSize: 2, level: 1, elevation: 40, landClass: 1 },
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
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    layer.render(gl, camera.matrix())
    gl.finish()
}
function currentShaderScale(): number {
    const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null
    const location = program && gl.getUniformLocation(program, 'metersPerPixel')
    if (!program || !location) throw new Error('Current grid shader has no scale uniform')
    return gl.getUniform(program, location) as number
}

async function main() {
    if (!gl) throw new Error('WebGL2 context unavailable')
    const camera = new PublicCamera()
    const layer = new TopologyLayer(camera as never)
    const inspection = { cell: view.chunks[0].cells[0], neighbors: [] }
    const inspectCalls: [number, number][] = []
    const requests: { blocks: DisplayBlock[], signal: AbortSignal, centerX: number, moving: boolean, resolve: (value: GridDisplayView) => void }[] = []
    const cameraQueries: DisplayBlock[][] = []
    let activeLoads = 0, maxActiveLoads = 0
    let nextView: GridDisplayView | null = view
    const source: ReadOnlyGridSource = {
        meta: { revision: 'browser-fixture', displayLayers: displayLayers([-2000, 0, 9000, 1000], [[1000, 1000], [2, 2]], [-2000, 0]),
            epsg: 3857, bounds: [-2000, 0, 9000, 1000], grid_info: [[1000, 1000], [2, 2]],
            level_info: [{ width: 11, height: 1 }, { width: 5500, height: 500 }], subdivide_rules: [[500, 500]],
            alignment_origin: [-2000, 0], cellCount: 102, attributes: ['level', 'elevation', 'landClass'], elevationRange: [0, 100], landClasses: [1] },
        loadBlocks(blocks, signal) {
            cameraQueries.push(blocks)
            if (nextView) { const value = nextView; nextView = null; return Promise.resolve(value) }
            const request = deferred<GridDisplayView>()
            activeLoads++
            maxActiveLoads = Math.max(maxActiveLoads, activeLoads)
            requests.push({ blocks, signal, centerX: camera.centerX, moving: camera.isMoving(), resolve: request.resolve })
            return request.promise.finally(() => { activeLoads-- })
        },
        inspect(x, y) { inspectCalls.push([x, y]); return Promise.resolve(inspection) },
    }
    const statsEvents: number[] = []
    const unsubscribe = layer.addDisplayStatsListener(stats => statsEvents.push(stats.gpuBytes))
    await layer.initialize(camera as never, gl)
    await layer.setReadOnlySource(source)
    draw(layer, camera)
    measurements.cameraBlocks = cameraQueries[0]
    const drawError = gl.getError()
    check('real shader compiles, links, and draws without GL error', drawError === gl.NO_ERROR, drawError)
    check('public camera selects visible schema blocks', cameraQueries.length === 1
        && cameraQueries[0].length > 0
        && cameraQueries[0].every(block => block.displayLayer <= block.blockLayer), cameraQueries)
    const half = pixel(256, 255), full = pixel(259, 255), hole = pixel(224, 224), real = pixel(160, 224)
    check('half occupied field has alpha about one half', near(half[3], 128), { half })
    check('full field has saturated alpha', full[3] === 255, { full })
    check('half occupied color is premultiplied once', half.slice(0, 3).every((v, i) => near(v, full[i] * 0.5, 4)), { half, full })
    check('hole stays transparent', hole[3] === 0, { hole })
    check('original cell renders', real[3] === 255, { real })
    const palette = Array.from(layer.paletteColorList.slice(3, 6))
    check('grid-node interior uses saturated density without invented outline', full.slice(0, 3).every((v, i) => near(v, palette[i] * 0.35, 3)), { full, palette })
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
    await frame()
    await until(() => requests.length === 1)
    let receivedPendingFrame = false
    const completeViewFrame = layer.waitForBenchmarkRenderFrame(1000)
    void completeViewFrame.then(() => { receivedPendingFrame = true })
    draw(layer, camera)
    await tick()
    check('benchmark frame waits for complete geometry while an older view can still render', !receivedPendingFrame && !layer.isReady)
    requests[requests.length - 1]!.resolve(JSON.parse(JSON.stringify(view)))
    await until(() => layer.isReady)
    draw(layer, camera)
    await completeViewFrame
    check('unchanged JSON chunks survive camera pan without buffer upload', uploads === 0, uploads)
    gl.bufferData = originalBufferData
    camera.centerX = 0
    layer.hide()
    check('hide frees all chunk allocations but retains palette', layer.getDisplayStats().gpuBytes === 768 && layer.getDisplayStats().visibleChunks === 0, layer.getDisplayStats())
    layer.show()
    await until(() => requests.length === 2)
    const shown = requests[requests.length - 1]!
    shown.resolve(view)
    await until(() => layer.isReady)
    check('show restores visible chunk', layer.getDisplayStats().gpuBytes === 960, layer.getDisplayStats())
    camera.moving = true
    camera.centerX = 8500
    camera.emit('move')
    await frame()
    await until(() => requests.length === 3)
    check('pan immediately evicts offscreen chunk', layer.getDisplayStats().gpuBytes === 768, layer.getDisplayStats())
    const stale = requests[requests.length - 1]!
    check('moving pan requests newly visible block geometry before moveend', stale.moving && stale.centerX === 8500
        && JSON.stringify(stale.blocks) !== JSON.stringify(cameraQueries[0]), stale)
    camera.centerX = 8600
    for (let i = 0; i < 120; i++) { camera.emit('move'); camera.emit('zoom') }
    await frame()
    check('new camera coalesces behind one uncanceled read request', !stale.signal.aborted && requests[requests.length - 1] === stale)
    stale.resolve(view)
    await until(() => requests.length === 4)
    const newest = requests[requests.length - 1]!
    check('completion starts one latest-camera read and keeps offscreen data evicted', !newest.signal.aborted && stale !== newest && layer.getDisplayStats().visibleChunks === 0)
    newest.resolve(farView)
    await until(() => layer.isReady)
    check('latest camera reaches ready with the correct visible chunk', layer.isReady && layer.getDisplayStats().gpuBytes === 832 && layer.getDisplayStats().visibleCells === 1, layer.getDisplayStats())
    draw(layer, camera)
    const movingPixel = pixel(250, 224)
    check('new viewport data renders while isMoving remains true', camera.isMoving() && newest.moving && movingPixel[3] === 255, { movingPixel, newest })
    canvas.dataset.movingPanImage = canvas.toDataURL('image/png')
    camera.centerX = 8700
    camera.moving = false
    camera.emit('moveend')
    await frame()
    await until(() => requests.length === 5)
    const final = requests[requests.length - 1]!
    const uploadAfterPan = gl.bufferData.bind(gl)
    let finalUploads = 0
    gl.bufferData = ((...args: Parameters<typeof gl.bufferData>) => { finalUploads++; uploadAfterPan(...args) }) as typeof gl.bufferData
    final.resolve(JSON.parse(JSON.stringify(farView)))
    await until(() => layer.isReady)
    gl.bufferData = originalBufferData
    check('motion termination commits the latest camera and retains unchanged distant buffers', final !== newest && final.centerX === 8700
        && layer.isReady && finalUploads === 0 && maxActiveLoads === 1, { final, finalUploads, maxActiveLoads })
    measurements.movingPan = { requestCameras: requests.map(request => ({ centerX: request.centerX, moving: request.moving })),
        maxActiveLoads, movingPixel, finalStats: layer.getDisplayStats(), finalUploads }
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
    core.init = callback => callback?.(undefined as never)
    editLayer.patchCore = core
    await until(() => editLayer.isReady)
    const originalDrawInstances = gl.drawArraysInstanced.bind(gl)
    let drawnVaos = new Set<WebGLVertexArrayObject>()
    gl.drawArraysInstanced = (...args) => {
        drawnVaos.add(gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject)
        originalDrawInstances(...args)
    }
    draw(editLayer, camera)
    const uneditedVaos = drawnVaos
    drawnVaos = new Set()
    const editBufferData = gl.bufferData.bind(gl)
    const editUploadBytes: number[] = []
    gl.bufferData = ((...args: Parameters<typeof gl.bufferData>) => {
        editUploadBytes.push((args[1] as ArrayBufferView).byteLength)
        editBufferData(...args)
    }) as typeof gl.bufferData
    camera.moving = true
    core.markCellsAsDeleted([0])
    await tick()
    await until(() => editLayer.isReady)
    draw(editLayer, camera)
    const retainedVaos = [...uneditedVaos].filter(vao => drawnVaos.has(vao)).length
    check('forced edit during motion uploads only the changed chunk and retains distant VAO identity',
        camera.isMoving() && editLayer.isReady && core.isDeleted(0) && uneditedVaos.size > 1
        && retainedVaos === uneditedVaos.size - 1 && editUploadBytes.length === 1 && editUploadBytes[0] === 64,
        { before: uneditedVaos.size, after: drawnVaos.size, retainedVaos, editUploadBytes })
    measurements.editInvalidation = { before: uneditedVaos.size, after: drawnVaos.size, retainedVaos, editUploadBytes: [...editUploadBytes] }
    gl.drawArraysInstanced = originalDrawInstances
    gl.bufferData = editBufferData
    core.restoreCells([0])
    await tick()
    await until(() => editLayer.isReady)
    camera.moving = false
    editLayer.executePickCells('brush', true, [64, 448])
    check('patch brush selects original storage id', editLayer.hitBuffer.all.join(',') === '0', editLayer.hitBuffer.all)
    editLayer.executeSubdivideCells()
    await tick()
    await until(() => editLayer.isReady)
    check('subdivision preserves editor selection and loaded-cell growth', core.cellNum === 7 && editLayer.hitBuffer.size === 4, { count: core.cellNum, selected: editLayer.hitBuffer.all })
    const hanging = await editLayer.inspectAt([320, 384])
    check('patch inspect returns real hanging neighbors at current storage ids', hanging.cell?.level === 1 && hanging.neighbors.filter(n => n.side === 'west').length === 2 && hanging.neighbors.every(n => n.edgeIds.length > 0), hanging)
    editLayer.executeDeleteCells()
    await tick()
    await until(() => editLayer.isReady)
    check('delete marks selected real cells and retains sparse selection', editLayer.hitBuffer.all.every(id => core.isDeleted(id)) && editLayer.hitBuffer.size === 4)
    editLayer.executeRecoverCells()
    await tick()
    await until(() => editLayer.isReady)
    check('restore clears real deletion flags', editLayer.hitBuffer.all.every(id => !core.isDeleted(id)) && editLayer.hitBuffer.size === 4)
    editLayer.executeMergeCells()
    await tick()
    await until(() => editLayer.isReady)
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
        await until(() => editLayer.isReady)
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
            meta: { revision: `checkerboard-${side}`, displayLayers: index.displayLayers,
                epsg: 3857, bounds: [0, 0, 1000, 1000], grid_info: [[1000, 1000], [pitch, pitch]], level_info: [{ width: 1, height: 1 }, { width: side, height: side }], subdivide_rules: [[side, side]], alignment_origin: [0, 0], cellCount: id - 1, attributes: ['level'], elevationRange: [0, 0], landClasses: [0] },
            loadBlocks(blocks) { return Promise.resolve(index.queryBlocks(blocks)) },
            inspect(x, y) { return Promise.resolve(index.inspect(x, y)) },
        })
        draw(densityLayer, camera)
        const stats = densityLayer.getDisplayStats()
        check(`checkerboard ${id - 1} displays half occupied opacity`, near(pixel(288, 224)[3], 128), pixel(288, 224))
        densityStats.push({ originals: id - 1, fields: stats.fieldSamples, gpuBytes: stats.gpuBytes })
        check(`checkerboard ${id - 1} originals draws only field samples`, stats.visibleCells === 0 && stats.fieldSamples === 1024 && stats.gpuBytes === 1024 * 64 + 768, stats)
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
    const contextRequests: { signal: AbortSignal; resolve: (view: GridDisplayView) => void }[] = []
    let initialContextView = true
    await restoringLayer.setReadOnlySource({ ...source, loadBlocks(_blocks, signal) {
        if (initialContextView) { initialContextView = false; return Promise.resolve(view) }
        const request = deferred<GridDisplayView>()
        contextRequests.push({ signal, resolve: request.resolve })
        return request.promise
    } })
    camera.moving = true
    camera.centerX = 1
    camera.emit('move')
    await frame()
    await until(() => contextRequests.length === 1)
    camera.centerX = 2
    camera.emit('move')
    canvas.dispatchEvent(new Event('webglcontextlost'))
    check('context loss aborts the active camera load and releases all allocations', contextRequests[0].signal.aborted
        && restoringLayer.getDisplayStats().gpuBytes === 0 && !restoringLayer.isReady, restoringLayer.getDisplayStats())
    canvas.dispatchEvent(new Event('webglcontextrestored'))
    await restoringLayer.whenInitialized()
    await until(() => contextRequests.length === 2)
    contextRequests[0].resolve({ chunks: [], cellCount: -1 })
    await tick()
    check('late canceled camera response cannot finish or replace the restored lifecycle', contextRequests.length === 2
        && !contextRequests[1].signal.aborted && !restoringLayer.isReady && restoringLayer.getDisplayStats().gpuBytes === 768,
        { requests: contextRequests.length, stats: restoringLayer.getDisplayStats() })
    contextRequests[1].resolve(view)
    await until(() => restoringLayer.isReady)
    draw(restoringLayer, camera)
    check('restored context commits the current camera while still moving', camera.isMoving() && restoringLayer.isReady
        && restoringLayer.getDisplayStats().visibleCells === 1 && pixel(160, 224)[3] === 255, restoringLayer.getDisplayStats())
    camera.moving = false
    camera.centerX = 0
    restoringLayer.remove(camera as never, gl)
    gl.createProgram = createProgram
    window.fetch = realFetch


    // Test the production shader, rather than only its CPU density helper.
    // The same uniform grid is viewed immediately below/above four CSS pixels.
    const uniformSide = 62.5
    const thresholdIndex = new DisplayIndex([-4000, -4000, 4000, 4000], {
        grid_info: [[1000, 1000], [uniformSide, uniformSide]], alignment_origin: [-4000, -4000],
    })
    const uniformCells = []
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
        const x0 = -4000 + x * uniformSide, y0 = -4000 + y * uniformSide
        uniformCells.push({ id: y * 128 + x, bounds: [x0, y0, x0 + uniformSide, y0 + uniformSide] as [number, number, number, number], level: 1, elevation: 0, landClass: 0 })
    }
    thresholdIndex.load(uniformCells)
    const thresholdMeasurements = []
    const movingScaleMeasurements = []
    const logicalFieldViews: { dpr: number; fields: number; chunks: number; minNodeCssPixels: number; gpuBytes: number }[] = []
    for (const dpr of [1, 2]) {
        canvas.width = SIZE * dpr; canvas.height = SIZE * dpr
        const pair = []
        for (const cellPixels of [3.999, 4.001, 16, 0.5]) {
            const thresholdCamera = new PublicCamera()
            thresholdCamera.span = SIZE * uniformSide / cellPixels
            const thresholdLayer = new TopologyLayer(thresholdCamera as never)
            let holdCamera = false
            const pendingViews: { blocks: DisplayBlock[]; resolve: (view: GridDisplayView) => void }[] = []
            let loadedView!: GridDisplayView
            await thresholdLayer.initialize(thresholdCamera as never, gl)
            await thresholdLayer.setReadOnlySource({
                meta: { revision: 'threshold-uniform', displayLayers: thresholdIndex.displayLayers,
                    epsg: 3857, bounds: [-4000, -4000, 4000, 4000], grid_info: [[1000, 1000], [uniformSide, uniformSide]],
                    level_info: [{ width: 8, height: 8 }, { width: 128, height: 128 }], subdivide_rules: [[16, 16]],
                    alignment_origin: [-4000, -4000], cellCount: uniformCells.length, attributes: ['level'], elevationRange: [0, 0], landClasses: [0] },
                loadBlocks(blocks) {
                    if (holdCamera) {
                        const request = deferred<GridDisplayView>()
                        pendingViews.push({ blocks, resolve: request.resolve })
                        return request.promise
                    }
                    loadedView = thresholdIndex.queryBlocks(blocks)
                    return Promise.resolve(loadedView)
                },
                inspect: async (x, y) => thresholdIndex.inspect(x, y),
            })
            draw(thresholdLayer, thresholdCamera)
            const palette = Array.from(thresholdLayer.paletteColorList.slice(3, 6))
            const channel = palette.indexOf(Math.max(...palette)), base = palette[channel]
            const extent = (cellPixels === 0.5 ? 32 : 384) * dpr, pixels = new Uint8Array(extent * extent * 4)
            const margin = (SIZE * dpr - extent) / 2
            gl.readPixels(margin, margin, extent, extent, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
            let sum = 0
            for (let i = channel; i < pixels.length; i += 4) sum += pixels[i]
            const meanDarkening = 1 - sum / (extent * extent * base)
            const expected = OUTLINE_DARKENING * (1 - (1 - Math.min(1, 1 / cellPixels)) ** 2)
            const stats = thresholdLayer.getDisplayStats()
            check(`DPR ${dpr} uniform ${cellPixels}px shader matches centered-line coverage`, Math.abs(meanDarkening - expected) < 0.01,
                { meanDarkening, expected, base, stats })
            check(`DPR ${dpr} uniform ${cellPixels}px field indicator matches transition`, stats.fieldMode === (cellPixels < 4), stats)
            pair.push({ cellPixels, meanDarkening, expected, stats })
            if (cellPixels === 0.5) {
                const minNodeCssPixels = Math.min(...loadedView.chunks.flatMap(chunk => chunk.fields.map(field =>
                    Math.min(field.bounds[2] - field.bounds[0], field.bounds[3] - field.bounds[1]) / (thresholdCamera.span / SIZE))))
                check(`DPR ${dpr} field nodes keep the 1.5 CSS pixel minimum`, stats.fieldSamples > 0 && minNodeCssPixels >= 1.5,
                    { minNodeCssPixels, stats })
                logicalFieldViews.push({ dpr, fields: stats.fieldSamples, chunks: stats.visibleChunks, minNodeCssPixels, gpuBytes: stats.gpuBytes })
            }
            if (cellPixels === 16) {
                holdCamera = true
                thresholdCamera.moving = true
                let geometryReads = 0, cameraUploads = 0, renderGeometryReads = 0, renderUploads = 0
                const watched = loadedView.chunks.flatMap(chunk => chunk.cells).map(cell => {
                    const bounds = cell.bounds
                    Object.defineProperty(cell, 'bounds', { configurable: true, get() { geometryReads++; return bounds } })
                    return { cell, bounds }
                })
                const scaleBufferData = gl.bufferData.bind(gl)
                gl.bufferData = ((...args: Parameters<typeof gl.bufferData>) => { cameraUploads++; scaleBufferData(...args) }) as typeof gl.bufferData
                const scales = []
                for (const currentPixels of [3.999, 4.001, 3.5, 16]) {
                    thresholdCamera.span = SIZE * uniformSide / currentPixels
                    // Render before the scheduled camera query or its network reply.
                    const readsBeforeRender = geometryReads, uploadsBeforeRender = cameraUploads
                    draw(thresholdLayer, thresholdCamera)
                    renderGeometryReads += geometryReads - readsBeforeRender
                    renderUploads += cameraUploads - uploadsBeforeRender
                    const shaderScale = currentShaderScale()
                    const currentStats = thresholdLayer.getDisplayStats()
                    const sampleSize = 64 * dpr
                    const sample = new Uint8Array(sampleSize * sampleSize * 4)
                    gl.readPixels((SIZE / 2 - 32) * dpr, (SIZE / 2 - 32) * dpr, sampleSize, sampleSize, gl.RGBA, gl.UNSIGNED_BYTE, sample)
                    let colorSum = 0
                    for (let i = channel; i < sample.length; i += 4) colorSum += sample[i]
                    const darkening = 1 - colorSum / (sampleSize * sampleSize * base)
                    const expectedDarkening = OUTLINE_DARKENING * (1 - (1 - 1 / currentPixels) ** 2)
                    check(`DPR ${dpr} moving ${currentPixels}px uses current shader scale before reply`,
                        Math.abs(shaderScale - uniformSide / currentPixels) < 0.00001
                        && Math.abs(darkening - expectedDarkening) < 0.01, { shaderScale, darkening, expectedDarkening })
                    check(`DPR ${dpr} moving ${currentPixels}px indicator follows CSS scale before reply`,
                        currentStats.fieldMode === (currentPixels < 4), currentStats)
                    if (dpr === 1 && currentPixels === 4.001) canvas.dataset.movingScaleImage = canvas.toDataURL('image/png')
                    scales.push({ currentPixels, shaderScale, darkening, expectedDarkening, fieldMode: currentStats.fieldMode })
                    thresholdCamera.emit('move')
                    thresholdCamera.emit('zoom')
                    await frame()
                    if (currentPixels === 3.999) await until(() => pendingViews.length === 1)
                }
                const readsBeforeStableFrame = geometryReads, uploadsBeforeStableFrame = cameraUploads
                thresholdCamera.emit('move')
                await frame()
                check(`DPR ${dpr} renders and stable camera frames use chunk invariants without rereading original geometry`,
                    renderGeometryReads === 0 && renderUploads === 0 && geometryReads === readsBeforeStableFrame
                    && cameraUploads === uploadsBeforeStableFrame && pendingViews.length === 1,
                    { renderGeometryReads, renderUploads, geometryReads, readsBeforeStableFrame, cameraUploads, uploadsBeforeStableFrame, requests: pendingViews.length })
                gl.bufferData = scaleBufferData
                for (const { cell, bounds } of watched) Object.defineProperty(cell, 'bounds', { configurable: true, writable: true, value: bounds })
                pendingViews[0].resolve(thresholdIndex.queryBlocks(pendingViews[0].blocks))
                await until(() => pendingViews.length === 2)
                draw(thresholdLayer, thresholdCamera)
                const scaleAfterReply = currentShaderScale()
                check(`DPR ${dpr} stale zoom reply cannot restore its old shader scale`, Math.abs(scaleAfterReply - uniformSide / 16) < 0.00001, scaleAfterReply)
                thresholdCamera.moving = false
                thresholdCamera.emit('moveend')
                await frame()
                pendingViews[1].resolve(thresholdIndex.queryBlocks(pendingViews[1].blocks))
                await until(() => thresholdLayer.isReady)
                check(`DPR ${dpr} final zoom view drains once and becomes ready`, thresholdLayer.isReady && pendingViews.length === 2, { stats: thresholdLayer.getDisplayStats(), requests: pendingViews.length })
                movingScaleMeasurements.push({ dpr, scales, renderGeometryReads, renderUploads, cameraUploads, scaleAfterReply, requests: pendingViews.length })
            }
            thresholdLayer.remove(thresholdCamera as never, gl)
        }
        const difference = Math.abs(pair[0].meanDarkening - pair[1].meanDarkening)
        check(`DPR ${dpr} uniform grid threshold mean darkening changes less than 0.01`, difference < 0.01, { difference, pair })
        thresholdMeasurements.push({ dpr, difference, pair })
    }
    canvas.width = SIZE; canvas.height = SIZE
    measurements.uniformThresholds = thresholdMeasurements
    measurements.movingScales = movingScaleMeasurements
    const geometry = logicalFieldViews.map(({ fields, chunks, minNodeCssPixels, gpuBytes }) => ({ fields, chunks, minNodeCssPixels, gpuBytes }))
    check('the same CSS field viewport selects identical nodes and GPU records at DPR 1 and 2',
        geometry.length === 2 && JSON.stringify(geometry[0]) === JSON.stringify(geometry[1]), logicalFieldViews)
    measurements.cssFieldViews = logicalFieldViews
    const wireLayer = new TopologyLayer(camera as never)
    await wireLayer.initialize(camera as never, gl)
    let reads = 0, transferred = true
    const cache = new DisplayBlockCache(source.meta, async (blocks, signal, decode) => {
        signal.throwIfAborted()
        if (!decode) throw new Error('Expected production worker decoder')
        reads += blocks.length
        const buffers = blocks.map(block => {
            const bounds = nodeBounds(displayLayer(source.meta.displayLayers, block.blockLayer), block.x, block.y, source.meta.alignment_origin)
            const layer = displayLayer(source.meta.displayLayers, block.displayLayer)
            const [x, y] = nodeRange(layer, bounds, source.meta.alignment_origin)
            const sample = nodeBounds(layer, x, y, source.meta.alignment_origin)
            const occupied = (sample[2] - sample[0]) * (sample[3] - sample[1]) * 0.5
            const buffer = new ArrayBuffer(80), data = new DataView(buffer)
            data.setUint32(0, 0x47444e34, false); data.setUint32(4, 1, true)
            sample.forEach((value, i) => data.setFloat64(16 + i * 8, value, true))
            data.setFloat64(48, occupied, true); data.setFloat64(56, occupied * 9.25, true)
            data.setFloat64(64, 2, true); data.setUint32(72, 2, true); data.setUint32(76, 7, true)
            return { block, buffer }
        })
        const chunks = await decode(buffers)
        transferred &&= buffers.every(item => item.buffer.byteLength === 0)
        return chunks
    })
    let wireView!: GridDisplayView
    await wireLayer.setReadOnlySource({ ...source, clearCache: () => cache.clear(),
        async loadBlocks(blocks, signal, decode) { wireView = await cache.query(blocks, signal, decode); return wireView } })
    check('real module worker decodes transferred GDN4 buffers in a finite block stream', transferred && reads > 0 && wireView.chunks.length > 0)
    check('worker-decoded summaries retain exact minc, occupancy and attributes', wireView.chunks.every(chunk => chunk.fields.every(field =>
        field.minCellSize === 2 && field.occupiedFraction === 0.5 && field.elevation === 9.25 && field.landClass === 7 && field.level === 2)))
    const cachedView = wireView, coldReads = reads
    let warmUploads = 0
    gl.bufferData = ((...args: Parameters<typeof gl.bufferData>) => { warmUploads++; originalBufferData(...args) }) as typeof gl.bufferData
    wireLayer.updateGPUCell()
    await tick()
    await until(() => wireLayer.isReady)
    gl.bufferData = originalBufferData
    check('warm immutable wire view performs no reads, decodes, geometry uploads or identity replacement',
        wireView === cachedView && reads === coldReads && warmUploads === 0, { reads, coldReads, warmUploads })
    wireLayer.remove(camera as never, gl)
}

main().catch(error => errors.push(error instanceof Error ? error.stack ?? error.message : String(error))).finally(() => {
    result.textContent = JSON.stringify({ ok: errors.length === 0, checks, errors, measurements, renderer: gl?.getParameter(gl.RENDERER), version: gl?.getParameter(gl.VERSION) })
    document.documentElement.dataset.done = 'true'
})
