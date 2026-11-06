import type { Map as MapboxMap } from 'mapbox-gl'
import proj4 from 'proj4'
import type { Converter } from 'proj4/dist/lib/core'
import PatchCore, { type PatchCellChange } from '../../../core/grid/patchCore'
import DisplayIndex from '../../../core/grid/displayIndex'
import type { Bounds, DisplayAttribute, DisplayBlock, DisplayCell, DisplayChunk, DisplayField, DisplayStats, GridDisplayView, GridInspection, ReadOnlyGridSource } from '../../../core/grid/displayTypes'
import { ELEVATION_LOW_COLOR, ELEVATION_HIGH_COLOR, OUTLINE_DARKENING } from '../../../core/grid/displayColors'
import type { CellCheckInfo, MultiCellBaseInfo } from '../../../core/grid/types'
import VibrantColorGenerator from '../../../core/util/vibrantColorGenerator'
import * as apis from '../../../template/api/apis'
import HitBuffer from './hitBuffer'
import { ChunkBuffers } from './chunkBuffers'
import type CustomLayerGroup from './customLayerGroup'
import type { NHCustomLayerInterface } from './interfaces'
import type { TopologyRenderSample } from './renderSample'
import { chunkMatrix, chunkOnScreen, displayCamera, gridPoint, mercatorPoint, polygonIntersectsBox } from './displayProjection'
import { selectDisplayBlocks } from '../../../core/grid/displayHierarchy'
import { CELL_PIXEL_THRESHOLD } from '../../../core/grid/displayMath'
import { gridDisplayI18n } from '../../../i18n/gridDisplay'
import { validateDisplayMeta } from '../../../core/grid/displayValidation'

const LEVEL_PALETTE_LENGTH = 256
const BENCHMARK_RENDER_FRAME_TIMEOUT_MS = 10000
const CAMERA_EVENTS = ['move', 'zoom', 'moveend', 'resize'] as const

type RenderSampleListener = (sample: TopologyRenderSample) => void
type BenchmarkEditOperation = 'pick' | 'subdivide' | 'merge' | 'delete' | 'recover'
interface BenchmarkEditOperationResult {
    operation: BenchmarkEditOperation
    cellCountBefore: number
    cellCountAfter: number
    selectedCellCount: number
    target?: Record<string, unknown>
}
type MultiRenderInfo = [number, Uint8Array, Float32Array, Float32Array, Uint8Array]

/** Camera-owned custom layer; all schema data and GPU allocations belong here. */
export default class TopologyLayer implements NHCustomLayerInterface {
    id = 'TopologyLayer'
    type = 'custom' as const
    layerGroup?: CustomLayerGroup
    visible = true
    initialized = false
    isTransparent = false
    lastPickedId = -1
    hitBuffer = new HitBuffer()
    paletteColorList = new Uint8Array(LEVEL_PALETTE_LENGTH * 3)
    hitFlag = new Uint8Array([1])
    unhitFlag = new Uint8Array([0])
    deletedFlag = new Uint8Array([1])
    undeletedFlag = new Uint8Array([0])
    _startCallback: () => void = () => {}
    _endCallback: () => void = () => {}
    resizeHandler = () => this.resizeOverlay()

    private _gl!: WebGL2RenderingContext
    private _buffers?: ChunkBuffers
    private _program: WebGLProgram | null = null
    private _palette: WebGLTexture | null = null
    private _textureBytes = 0
    private _gpuInitPromise?: Promise<void>
    private _gpuEpoch = 0
    private _patchCore: PatchCore | null = null
    private _index?: DisplayIndex
    private _selectionIndex?: DisplayIndex
    private _unsubscribePatch?: () => void
    private _source?: ReadOnlyGridSource
    private _projection?: Converter
    private _attribute: DisplayAttribute = 'level'
    private _showDeletedCells = true
    private _dataReady = false
    private _loading = false
    private _view: GridDisplayView = { chunks: [], cellCount: 0 }
    private _metersPerPixel = 1
    private _blocks: DisplayBlock[] = []
    private _request?: AbortController
    private _viewPromise?: Promise<void>
    private _pendingView = false
    private _forceView = false
    private _lastCamera?: string
    private _generation = 0
    private _scheduled?: object
    private _cameraFrame?: number
    private _contextUnavailable = false
    private _removed = false
    private _overlayCanvas: HTMLCanvasElement | null = null
    private _overlayCtx: CanvasRenderingContext2D | null = null
    private _fieldIndicator: HTMLDivElement | null = null
    private _updateFieldIndicator = () => {
        if (!this._fieldIndicator) return
        this._fieldIndicator.textContent = gridDisplayI18n.t('fieldActive')
        this._fieldIndicator.style.display = this.visible && this._stats.fieldMode ? 'block' : 'none'
    }
    private _resizeObserver?: ResizeObserver
    private _renderSampleListeners = new Set<RenderSampleListener>()
    private _displayListeners = new Set<(stats: DisplayStats) => void>()
    private _stats: DisplayStats = { gpuBytes: 0, visibleChunks: 0, visibleCells: 0, fieldSamples: 0, fieldMode: false, ready: false }
    private _selectionVersions = new Map<string, number>()
    private _activeIds = new Set<number>()
    private _subdividableIds = new Set<number>()
    private _mergeGroups = new Map<string, { ids: Set<number>; required: number }>()
    private _completeMergeGroups = new Set<string>()
    private _benchmarkSubdivideChildGroups = new Map<number, number[]>()
    private _benchmarkDeletedGroups = new Map<number, number[]>()
    private _cameraChanged = () => {
        if (!this._dataReady || !this.visible || this._removed || this._contextUnavailable || this._cameraFrame !== undefined) return
        const frame = requestAnimationFrame(() => {
            if (this._cameraFrame !== frame) return
            this._cameraFrame = undefined
            this.updateCameraScale()
            this.syncGPU()
            this.requestView(false)
        })
        this._cameraFrame = frame
    }
    private _keyDown = (event: KeyboardEvent) => {
        if (event.key === 'A' && this._patchCore && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) this.executePickAllCells()
    }
    private _contextLost = () => { this._contextUnavailable = true; this.cancelView(); this.releaseGPU(); this.emitStats() }
    private _contextRestored = () => {
        void this.initGPUResource().then(() => {
            if (!this.initialized || this._removed) return
            this._contextUnavailable = false
            this.requestView()
        }).catch(error => console.error('Grid renderer initialization failed', error))
    }

    constructor(public map: MapboxMap) {
        const generator = new VibrantColorGenerator()
        for (let i = 0; i < LEVEL_PALETTE_LENGTH; i++) this.paletteColorList.set(generator.nextColor(), i * 3)
    }

    get attribute(): DisplayAttribute { return this._attribute }
    set attribute(value: DisplayAttribute) {
        if (!['level', 'elevation', 'landClass'].includes(value)) throw new Error('Unknown grid display attribute')
        this._attribute = value
        this.map.triggerRepaint()
    }
    get showDeletedCells(): boolean { return this._showDeletedCells }
    set showDeletedCells(value: boolean) { this._showDeletedCells = value; this.requestView() }
    get patchCore(): PatchCore {
        if (!this._patchCore) throw new Error('PatchCore is not initialized')
        return this._patchCore
    }
    set patchCore(core: PatchCore) {
        this.detachSource()
        this._patchCore = core
        const generation = this._generation
        this.startCallback()
        core.init(() => {
            if (this._patchCore !== core || generation !== this._generation || this._removed) return
            this._projection = proj4(core.srcCRS, 'EPSG:4326')
            this.rebuildPatchIndex()
            this._unsubscribePatch = core.addChangeListener(change => this.patchChanged(change))
            this._dataReady = true
            this.requestView()
            this.endCallback()
        })
    }
    get isReady(): boolean { return this.initialized && this._dataReady && !this._loading }
    set startCallback(callback: () => void) { this._startCallback = () => { callback(); this.map.triggerRepaint() } }
    get startCallback(): () => void { return this._startCallback }
    set endCallback(callback: () => void) { this._endCallback = () => { callback(); this.map.triggerRepaint() } }
    get endCallback(): () => void { return this._endCallback }

    async setReadOnlySource(source: ReadOnlyGridSource): Promise<void> {
        validateDisplayMeta(source.meta)
        this.detachSource()
        this._source = source
        const generation = this._generation
        const crs = `EPSG:${source.meta.epsg}`
        if (!proj4.defs(crs)) proj4.defs(crs, await apis.proj.getProj4Defs(source.meta.epsg))
        if (generation !== this._generation) return
        this._projection = proj4(crs, 'EPSG:4326')
        this._dataReady = true
        this.requestView()
        await this.refreshView()
    }

    async inspectAt(point: [number, number]): Promise<GridInspection> {
        if (!this._projection || !this._dataReady) return { cell: null, neighbors: [] }
        const [x, y] = gridPoint(this.map, this._projection, point)
        if (this._source) return this._source.inspect(x, y)
        return this._index!.inspect(x, y, this._showDeletedCells)
    }

    getDisplayStats(): DisplayStats { return { ...this._stats } }
    addDisplayStatsListener(listener: (stats: DisplayStats) => void): () => void {
        this._displayListeners.add(listener)
        return () => this._displayListeners.delete(listener)
    }
    addRenderSampleListener(listener: RenderSampleListener): () => void {
        this._renderSampleListeners.add(listener)
        return () => this.removeRenderSampleListener(listener)
    }
    removeRenderSampleListener(listener: RenderSampleListener): void { this._renderSampleListeners.delete(listener) }
    waitForBenchmarkRenderFrame(timeoutMs?: number): Promise<TopologyRenderSample> { return this._waitForBenchmarkRenderFrame(timeoutMs) }
    async runBenchmarkEditOperation(operation: BenchmarkEditOperation, trialIndex: number): Promise<BenchmarkEditOperationResult> {
        if (!this.isReady || !this._patchCore) throw new Error('Editable topology layer is not ready')
        switch (operation) {
            case 'pick': return this._runBenchmarkPick(trialIndex)
            case 'subdivide': return this._runBenchmarkSubdivide(trialIndex)
            case 'merge': return this._runBenchmarkMerge(trialIndex)
            case 'delete': return this._runBenchmarkDelete(trialIndex)
            case 'recover': return this._runBenchmarkRecover(trialIndex)
        }
    }

    async initialize(_: MapboxMap, gl: WebGL2RenderingContext): Promise<void> {
        this._gl = gl
        this._removed = false
        this._contextUnavailable = false
        this.initDOM()
        await this.initGPUResource()
        this.requestView()
    }
    whenInitialized(): Promise<void> {
        return this._gpuInitPromise ?? Promise.reject(new Error('Topology layer has not been added to the map'))
    }
    initDOM(): void {
        if (this._overlayCanvas) return
        this._overlayCanvas = document.createElement('canvas')
        Object.assign(this._overlayCanvas.style, { top: '0', left: '0', position: 'absolute', pointerEvents: 'none', zIndex: '1' })
        this._overlayCtx = this._overlayCanvas.getContext('2d')
        this.map.getContainer().appendChild(this._overlayCanvas)
        this._fieldIndicator = document.createElement('div')
        this._fieldIndicator.setAttribute('role', 'status')
        Object.assign(this._fieldIndicator.style, { position: 'absolute', bottom: '12px', left: '12px', padding: '4px 8px', background: '#252525', color: '#fff', fontSize: '12px', pointerEvents: 'none', zIndex: '1' })
        this.map.getContainer().appendChild(this._fieldIndicator)
        this._updateFieldIndicator()
        gridDisplayI18n.on('languageChanged', this._updateFieldIndicator)
        this._resizeObserver = new ResizeObserver(this.resizeHandler)
        this._resizeObserver.observe(this.map.getContainer())
        this.resizeOverlay()
        for (const event of CAMERA_EVENTS) this.map.on(event, this._cameraChanged)
        this.map.getCanvas().addEventListener('webglcontextlost', this._contextLost)
        this.map.getCanvas().addEventListener('webglcontextrestored', this._contextRestored)
        window.addEventListener('keydown', this._keyDown)
    }
    initGPUResource(): Promise<void> {
        if (this._gpuInitPromise) return this._gpuInitPromise
        const epoch = this._gpuEpoch
        this._gpuInitPromise = (async () => {
            const response = await fetch('/shaders/patch/display.glsl')
            if (!response.ok) throw new Error(`Grid shader HTTP ${response.status}`)
            const source = await response.text()
            if (this._removed || epoch !== this._gpuEpoch || this._gl.isContextLost()) return
            const gl = this._gl
            this._program = createProgram(gl, source)
            this._buffers = new ChunkBuffers(gl)
            this._palette = gl.createTexture()
            if (!this._palette) throw new Error('Unable to allocate grid palette')
            gl.bindTexture(gl.TEXTURE_2D, this._palette)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
            const alignment = gl.getParameter(gl.UNPACK_ALIGNMENT) as number
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, LEVEL_PALETTE_LENGTH, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, this.paletteColorList)
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, alignment)
            gl.bindTexture(gl.TEXTURE_2D, null)
            if (gl.getError() !== gl.NO_ERROR) throw new Error('Unable to upload grid palette')
            this._textureBytes = this.paletteColorList.byteLength
            this.initialized = true
            this.syncGPU()
            this.emitStats()
        })().catch(error => { if (epoch === this._gpuEpoch) this.releaseGPU(); throw error })
        return this._gpuInitPromise
    }

    private patchCell(id: number): DisplayCell {
        const core = this.patchCore
        const [level, globalId] = core.getInfoByStorageId(id)
        const { width, height } = core.levelInfos[level]
        const box = core.bBox
        const x = globalId % width
        const y = Math.floor(globalId / width)
        const dx = (box.xMax - box.xMin) / width
        const dy = (box.yMax - box.yMin) / height
        return { id, bounds: [box.xMin + x * dx, box.yMin + y * dy, box.xMin + (x + 1) * dx, box.yMin + (y + 1) * dy], level, elevation: 0, landClass: 0, deleted: core.isDeleted(id) }
    }
    private rebuildPatchIndex(): void {
        const core = this.patchCore
        const [width, height] = core.bBox.size
        const schema = {
            grid_info: core.levelInfos.map(info => [width / info.width, height / info.height] as [number, number]),
            alignment_origin: [core.bBox.xMin, core.bBox.yMin] as [number, number],
        }
        this._index = new DisplayIndex(core.bBox.boundary, schema)
        this._selectionIndex = new DisplayIndex(core.bBox.boundary, schema)
        this._activeIds.clear()
        this._subdividableIds.clear()
        this._mergeGroups.clear()
        this._completeMergeGroups.clear()
        this._index.load(this.patchCells())
    }
    private *patchCells(): IterableIterator<DisplayCell> {
        for (let id = 0; id < this.patchCore.cellNum; id++) {
            const cell = this.patchCell(id)
            this.trackCell(cell, true)
            yield cell
        }
    }
    private patchChanged(change: PatchCellChange): void {
        if (change.reset) this.rebuildPatchIndex()
        else {
            const selectedGeometry = new Set<string>()
            const geometryKey = (cell: DisplayCell) => `${cell.level}:${cell.bounds.join(',')}`
            for (const id of change.removed) {
                const cell = this._index!.getCell(id)
                if (cell) this.trackCell(cell, false)
                if (cell && this.hitBuffer.isHit(id)) selectedGeometry.add(geometryKey(cell))
                this._index!.remove(id)
                this._selectionIndex!.remove(id)
                this.hitBuffer.remove(id)
            }
            for (const id of change.upserted) {
                const previous = this._index!.getCell(id)
                if (previous) this.trackCell(previous, false)
                const cell = this.patchCell(id)
                this._index!.upsert(cell)
                this.trackCell(cell, true)
                if (selectedGeometry.has(geometryKey(cell))) this.hitBuffer.add(id)
                if (this.hitBuffer.isHit(id)) this._selectionIndex!.upsert(cell)
            }
        }
        this.requestView()
    }
    private requestView(force = true): void {
        if (!this._dataReady || !this.visible || this._removed || this._contextUnavailable) return
        this._pendingView = true
        this._forceView ||= force
        // Camera events arrive once per browser frame; edits use this microtask
        // immediately. An active load drains only the latest pending camera.
        if (this._scheduled || this._viewPromise) return
        const scheduled = {}
        this._scheduled = scheduled
        queueMicrotask(() => {
            if (this._scheduled !== scheduled) return
            this._scheduled = undefined
            void this.refreshView().catch(error => { if (!this._removed) console.error('Grid display query failed', error) })
        })
        this.map.triggerRepaint()
    }
    private refreshView(): Promise<void> {
        if (this._viewPromise) return this._viewPromise
        if (!this._projection || !this._dataReady || !this.visible || this._removed || this._contextUnavailable || !this._pendingView) return Promise.resolve()
        const generation = this._generation
        const load = async () => {
            while (this._pendingView && this._dataReady && this.visible && !this._removed && generation === this._generation) {
                const camera = displayCamera(this.map, this._projection!)
                this._metersPerPixel = camera.metersPerPixel
                const signature = `${camera.bounds.join(',')}:${camera.metersPerPixel}`
                const force = this._forceView
                this._pendingView = false
                this._forceView = false
                if (!force && signature === this._lastCamera) continue
                const request = new AbortController()
                this._request = request
                this._loading = true
                this.emitStats()
                try {
                    const layers = this._source?.meta.displayLayers ?? this._index!.displayLayers
                    const origin = this._source?.meta.alignment_origin ?? this._index!.origin
                    const blocks = signature === this._lastCamera ? this._blocks : selectDisplayBlocks(layers, origin, camera.bounds, point => {
                        const screen = this.map.project(this._projection!.forward(point) as [number, number])
                        return [screen.x, screen.y]
                    })
                    const view = this._source
                        ? await this._source.loadBlocks(blocks, request.signal)
                        : this._index!.queryBlocks(blocks, this._showDeletedCells)
                    if (request.signal.aborted || generation !== this._generation || this._removed) return
                    this._view = this._source ? reuseChunks(this._view, view) : view
                    this._lastCamera = signature
                    this._blocks = blocks
                    this.syncGPU()
                    this.map.triggerRepaint()
                } catch (error) {
                    if (request.signal.aborted || generation !== this._generation) return
                    this._dataReady = false
                    this._buffers?.clear()
                    throw error
                }
            }
        }
        const promise = load().finally(() => {
            if (this._viewPromise !== promise) return
            this._viewPromise = undefined
            this._request = undefined
            this._loading = false
            this.emitStats()
            if (this._pendingView) this.requestView(this._forceView)
        })
        this._viewPromise = promise
        return promise
    }
    private visibleChunks(): DisplayChunk[] {
        if (!this._projection || !this.visible) return []
        return this._view.chunks.filter(chunk => chunkOnScreen(this.map, this._projection!, chunk.bounds))
    }
    private syncGPU(): void {
        if (!this.initialized || !this._buffers || !this._projection) return
        this._buffers.sync(this.visibleChunks(), key => `${this._index?.getChunkRevision(key) ?? 0}:${this._selectionVersions.get(key) ?? 0}`, chunk => this.prepareChunk(chunk))
        this.emitStats()
    }
    private updateCameraScale(): void {
        if (!this._projection) return
        const scale = displayCamera(this.map, this._projection).metersPerPixel
        if (scale === this._metersPerPixel) return
        this._metersPerPixel = scale
        this.emitStats()
    }
    private prepareChunk(chunk: DisplayChunk): { data: Float32Array; origin: [number, number] } {
        const projection = this._projection!
        const origin = mercatorPoint(projection, [(chunk.bounds[0] + chunk.bounds[2]) / 2, (chunk.bounds[1] + chunk.bounds[3]) / 2])
        const data = new Float32Array((chunk.cells.length + chunk.fields.length) * 16)
        const add = (sample: DisplayCell | DisplayField, field: boolean, index: number) => {
            const [x0, y0, x1, y1] = sample.bounds
            const corners: [number, number][] = [[x0, y1], [x1, y1], [x0, y0], [x1, y0]]
            const offset = index * 16
            corners.forEach((xy, corner) => {
                const mercator = mercatorPoint(projection, xy)
                data[offset + corner * 2] = mercator[0] - origin[0]
                data[offset + corner * 2 + 1] = mercator[1] - origin[1]
            })
            const cell = sample as DisplayCell
            const summary = sample as DisplayField
            data.set([sample.level, sample.elevation, sample.landClass, field ? summary.minCellSize : Math.min(x1 - x0, y1 - y0), field ? x1 - x0 : 0, field ? y1 - y0 : cell.deleted ? 1 : 0, (field ? this.fieldSelection(summary) : this.hitBuffer.isHit(cell.id) ? 1 : 0), field ? summary.occupiedFraction : 1], offset + 8)
        }
        chunk.cells.forEach((cell, index) => add(cell, false, index))
        chunk.fields.forEach((field, index) => add(field, true, chunk.cells.length + index))
        return { data, origin }
    }
    private emitStats(): void {
        const resources = [...(this._buffers?.chunks.values() ?? [])]
        const fieldSamples = resources.reduce((sum, chunk) => sum + chunk.fieldSamples, 0)
        const next: DisplayStats = { gpuBytes: (this._buffers?.gpuBytes ?? 0) + this._textureBytes, visibleChunks: resources.length, visibleCells: resources.reduce((sum, chunk) => sum + chunk.visibleCells, 0), fieldSamples, fieldMode: fieldSamples > 0 || resources.some(chunk => chunk.minOriginalCellSize / this._metersPerPixel < CELL_PIXEL_THRESHOLD), ready: this.isReady }
        if (Object.keys(next).some(key => next[key as keyof DisplayStats] !== this._stats[key as keyof DisplayStats])) {
            this._stats = next
            for (const listener of this._displayListeners) listener({ ...next })
        }
        this._updateFieldIndicator()
    }

    render(gl: WebGL2RenderingContext, matrix: number[]): void {
        if (!this.visible || !this.initialized || !this._dataReady || !this._program || !this._buffers) return
        const start = performance.now()
        this.updateCameraScale()
        let passCount = 0
        if (!this.isTransparent) {
            gl.useProgram(this._program)
            gl.disable(gl.DEPTH_TEST)
            gl.disable(gl.CULL_FACE)
            gl.enable(gl.BLEND)
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
            gl.activeTexture(gl.TEXTURE0)
            gl.bindTexture(gl.TEXTURE_2D, this._palette)
            const uniform = (name: string) => gl.getUniformLocation(this._program!, name)
            gl.uniform1i(uniform('paletteTexture'), 0)
            gl.uniform1i(uniform('displayAttribute'), ['level', 'elevation', 'landClass'].indexOf(this._attribute))
            gl.uniform1f(uniform('metersPerPixel'), this._metersPerPixel)
            gl.uniform1f(uniform('devicePixelRatio'), gl.canvas.width / Math.max(1, this.map.getCanvas().clientWidth))
            gl.uniform2fv(uniform('elevationRange'), this._source?.meta.elevationRange ?? [0, 1])
            gl.uniform3fv(uniform('elevationLowColor'), ELEVATION_LOW_COLOR)
            gl.uniform3fv(uniform('elevationHighColor'), ELEVATION_HIGH_COLOR)
            gl.uniform1f(uniform('outlineDarkening'), OUTLINE_DARKENING)
            for (const chunk of this._buffers.chunks.values()) {
                gl.uniformMatrix4fv(uniform('matrix'), false, chunkMatrix(matrix, chunk.origin))
                gl.bindVertexArray(chunk.vao)
                gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, chunk.count)
                passCount++
            }
            gl.bindVertexArray(null)
            gl.bindTexture(gl.TEXTURE_2D, null)
        }
        const end = performance.now()
        const sample: TopologyRenderSample = { timestampMs: end, renderDurationMs: end - start, cellCount: this._patchCore?.cellNum ?? this._source?.meta.cellCount ?? 0, layerId: this.id, passCount, visible: this.visible }
        for (const listener of this._renderSampleListeners) listener(sample)
    }

    private _hit(storageIds: number | number[], addMode = true): void {
        const ids = Array.isArray(storageIds) ? storageIds : [storageIds]
        const changed = new Set<number>()
        for (const id of ids) {
            if (!Number.isInteger(id) || id < 0 || !this._patchCore || id >= this._patchCore.cellNum) continue
            if (this.hitBuffer.isHit(id) === addMode) continue
            if (addMode) this.hitBuffer.add(id)
            else this.hitBuffer.remove(id)
            changed.add(id)
        }
        this.selectionChanged(changed)
    }
    private fieldSelection(field: DisplayField): number {
        if (!this._patchCore || this.hitBuffer.size === 0) return 0
        if (this.hitBuffer.size === this._patchCore.cellNum) return 1
        const selected = this._selectionIndex?.summarize(field.bounds, this._showDeletedCells)
        return selected ? Math.min(1, selected.occupiedFraction / field.occupiedFraction) : 0
    }
    private selectionChanged(ids: Set<number>): void {
        if (!ids.size) return
        const changed: Bounds[] = []
        for (const id of ids) {
            const cell = this._index?.getCell(id)
            if (!cell) continue
            changed.push(cell.bounds)
            if (this.hitBuffer.isHit(id)) this._selectionIndex?.upsert(cell)
            else this._selectionIndex?.remove(id)
        }
        for (const chunk of this._view.chunks) {
            if (changed.some(bounds => bounds[0] < chunk.bounds[2] && bounds[2] > chunk.bounds[0] && bounds[1] < chunk.bounds[3] && bounds[3] > chunk.bounds[1])) this._selectionVersions.set(chunk.key, (this._selectionVersions.get(chunk.key) ?? 0) + 1)
        }
        this.syncGPU()
        this.map.triggerRepaint()
    }
    executeClearSelection(): number[] {
        const ids = this.hitBuffer.clear()
        this.selectionChanged(new Set(ids))
        return ids
    }
    executePickAllCells(): void {
        if (!this._patchCore) return
        this.startCallback()
        this._hit(Array.from({ length: this._patchCore.cellNum }, (_, i) => i))
        this.endCallback()
    }
    executePickCells(type: string, mode: boolean, start: [number, number], end?: [number, number]): void {
        if (!this._index || !this._projection || !this._patchCore) return
        this.startCallback()
        if (type === 'brush') {
            const [x, y] = gridPoint(this.map, this._projection, start)
            const cell = this._index.inspect(x, y, this._showDeletedCells).cell
            this.lastPickedId = cell?.id ?? -1
            if (cell) this._hit(cell.id, mode)
        } else if (type === 'box' && end) {
            const points = [start, end, [start[0], end[1]], [end[0], start[1]]] as [number, number][]
            const coordinates = points.map(point => gridPoint(this.map, this._projection!, point))
            const box: Bounds = [Math.min(...coordinates.map(p => p[0])), Math.min(...coordinates.map(p => p[1])), Math.max(...coordinates.map(p => p[0])), Math.max(...coordinates.map(p => p[1]))]
            const screenBox: Bounds = [Math.min(start[0], end[0]), Math.min(start[1], end[1]), Math.max(start[0], end[0]), Math.max(start[1], end[1])]
            const ids = this._index.selectBounds(box, this._showDeletedCells).filter(id => {
                const bounds = this._index!.getCell(id)!.bounds
                const corners = [[bounds[0], bounds[1]], [bounds[2], bounds[1]], [bounds[2], bounds[3]], [bounds[0], bounds[3]]]
                const polygon = corners.map(xy => this.map.project(this._projection!.forward(xy) as [number, number])).map(p => [p.x, p.y] as [number, number])
                return polygonIntersectsBox(polygon, screenBox)
            })
            this._hit(ids, mode)
        }
        this.endCallback()
    }
    executeCheckCell(point: [number, number]): CellCheckInfo | null {
        this.executeClearSelection()
        if (!this._index || !this._projection || !this._patchCore) return null
        const [x, y] = gridPoint(this.map, this._projection, point)
        const cell = this._index.inspect(x, y, this._showDeletedCells).cell
        if (!cell) return null
        this._hit(cell.id)
        return this._patchCore.check(cell.id)
    }
    executePickCellsByFeature(path: string, addMode = true): void {
        this.startCallback()
        this.patchCore.getCellInfoByFeature(path, (ids: number[]) => { this._hit(ids, addMode); this.endCallback() })
    }
    executePickCellsByVectorNode(node: string, lock: string | null, addMode = true): void {
        this.startCallback()
        this.patchCore.getCellInfoByVectorNode(node, lock, (ids: number[]) => { this._hit(ids, addMode); this.endCallback() })
    }
    deleteCellsLocally(ids: number[]): void {
        if (!ids.length) return
        this.startCallback()
        this.patchCore.deleteCellsLocally(ids, () => this.endCallback())
    }
    deleteCells(ids: number[]): void {
        if (!ids.length) return
        this.startCallback()
        this.patchCore.markCellsAsDeleted(ids, () => { this._hit(ids); this.endCallback() })
    }
    restoreCells(ids: number[]): void {
        if (!ids.length) return
        this.startCallback()
        this.patchCore.restoreCells(ids, () => { this._hit(ids); this.endCallback() })
    }
    executeDeleteCells(): void { this.deleteCells(this.executeClearSelection().filter(id => !this.patchCore.isDeleted(id))) }
    executeRecoverCells(): void { this.restoreCells(this.executeClearSelection().filter(id => this.patchCore.isDeleted(id))) }
    executeSubdivideCells(): void {
        const ids = this.executeClearSelection().filter(id => !this.patchCore.isDeleted(id) && this.patchCore.getInfoByStorageId(id)[0] < this.patchCore.maxLevel)
        if (!ids.length) return
        const info = { levels: Uint8Array.from(ids, id => this.patchCore.getInfoByStorageId(id)[0]), globalIds: Uint32Array.from(ids, id => this.patchCore.getInfoByStorageId(id)[1]) }
        this.startCallback()
        this.patchCore.deleteCellsLocally(ids, () => {
            this.patchCore.subdivideCells(info, (renderInfo: MultiRenderInfo) => { this._hit(Array.from(renderInfo[1], (_, i) => renderInfo[0] + i)); this.endCallback() })
        })
    }
    executeMergeCells(): void {
        const ids = this.executeClearSelection().filter(id => !this.patchCore.isDeleted(id))
        if (!ids.length) return
        this.startCallback()
        this.patchCore.mergeCells(ids, (info: { childStorageIds: number[]; parentInfo: MultiCellBaseInfo }) => {
            if (!info.parentInfo.levels.length) { this._hit(ids); this.endCallback(); return }
            this.patchCore.deleteCellsLocally(info.childStorageIds, () => {
                this.patchCore.updateMultiCellRenderInfo(info.parentInfo, (renderInfo: MultiRenderInfo) => { this._hit(Array.from(renderInfo[1], (_, i) => renderInfo[0] + i)); this.endCallback() })
            })
        })
    }
    // Legacy editor hooks are notifications; actual invalidation comes from PatchCore.
    updateGPUCell(info?: [number, number, Float32Array, Float32Array, number]): void { void info; this.requestView() }
    updateGPUCells(info?: MultiRenderInfo): void { void info; this.requestView() }
    copyGPUCell(source: number, target: number): void { void source; void target; this.requestView() }

    private async _runBenchmarkPick(trialIndex: number): Promise<BenchmarkEditOperationResult> {
        const target = this._findBenchmarkStorageId(trialIndex, storageId => !this.patchCore.isDeleted(storageId))
        if (target === null) throw new Error('No selectable benchmark target was found')

        const cellCountBefore = this.patchCore.cellNum
        this.executeClearSelection()
        this._hit(target)

        const sample = await this._waitForBenchmarkRenderFrame()
        return {
            operation: 'pick',
            cellCountBefore,
            cellCountAfter: sample.cellCount,
            selectedCellCount: 1,
            target: this._getBenchmarkTargetMetadata(target),
        }
    }

    private async _runBenchmarkSubdivide(trialIndex: number): Promise<BenchmarkEditOperationResult> {
        const target = this._findBenchmarkStorageId(
            trialIndex,
            storageId => {
                const [level] = this.patchCore.getInfoByStorageId(storageId)
                return level < this.patchCore.maxLevel && !this.patchCore.isDeleted(storageId)
            },
            true,
        )
        if (target === null) throw new Error('No subdividable benchmark target was found')

        const cellCountBefore = this.patchCore.cellNum
        const targetMetadata = this._getBenchmarkTargetMetadata(target)
        this.executeClearSelection()
        const [level, globalId] = this.patchCore.getInfoByStorageId(target)
        await this._benchmarkDeleteCellsLocally([target])
        const childStorageIds = await this._benchmarkSubdivideCells({
            levels: new Uint8Array([level]),
            globalIds: new Uint32Array([globalId]),
        })
        this._benchmarkSubdivideChildGroups.set(trialIndex, childStorageIds)
        const sample = await this._waitForBenchmarkRenderFrame()
        this.executeClearSelection()

        return {
            operation: 'subdivide',
            cellCountBefore,
            cellCountAfter: sample.cellCount,
            selectedCellCount: 1,
            target: {
                ...targetMetadata,
                childStorageIds,
            },
        }
    }

    private async _runBenchmarkMerge(trialIndex: number): Promise<BenchmarkEditOperationResult> {
        const childStorageIds = this._benchmarkSubdivideChildGroups.get(trialIndex) ?? []
        const preferredStorageIds = childStorageIds.filter(storageId => storageId >= 0 && storageId < this.patchCore.cellNum && !this.patchCore.isDeleted(storageId))
        const mergeableStorageIds = preferredStorageIds.length
            ? preferredStorageIds
            : this._findBenchmarkMergeGroup(trialIndex)
        if (!mergeableStorageIds.length) throw new Error('No valid benchmark child group is available for merge')

        const cellCountBefore = this.patchCore.cellNum
        this.executeClearSelection()
        const mergedStorageIds = await this._benchmarkMergeCells(mergeableStorageIds)
        const sample = await this._waitForBenchmarkRenderFrame()
        this.executeClearSelection()

        return {
            operation: 'merge',
            cellCountBefore,
            cellCountAfter: sample.cellCount,
            selectedCellCount: mergeableStorageIds.length,
            target: {
                childStorageIds: mergeableStorageIds,
                mergedStorageIds,
            },
        }
    }

    private async _runBenchmarkDelete(trialIndex: number): Promise<BenchmarkEditOperationResult> {
        const target = this._findBenchmarkStorageId(trialIndex, storageId => !this.patchCore.isDeleted(storageId))
        if (target === null) throw new Error('No deletable benchmark target was found')

        const cellCountBefore = this.patchCore.cellNum
        const targetMetadata = this._getBenchmarkTargetMetadata(target)
        this.executeClearSelection()
        await this._benchmarkMarkCellsAsDeleted([target])
        const sample = await this._waitForBenchmarkRenderFrame()
        this._benchmarkDeletedGroups.set(trialIndex, [target])

        return {
            operation: 'delete',
            cellCountBefore,
            cellCountAfter: sample.cellCount,
            selectedCellCount: 1,
            target: targetMetadata,
        }
    }

    private async _runBenchmarkRecover(trialIndex: number): Promise<BenchmarkEditOperationResult> {
        const deletedStorageIds = this._benchmarkDeletedGroups.get(trialIndex)?.filter(storageId => (
            storageId >= 0 && storageId < this.patchCore.cellNum && this.patchCore.isDeleted(storageId)
        ))
        if (!deletedStorageIds?.length) {
            throw new Error('No deleted benchmark target is available for recover')
        }

        const cellCountBefore = this.patchCore.cellNum
        this.executeClearSelection()
        await this._benchmarkRestoreCells(deletedStorageIds)
        const sample = await this._waitForBenchmarkRenderFrame()

        return {
            operation: 'recover',
            cellCountBefore,
            cellCountAfter: sample.cellCount,
            selectedCellCount: deletedStorageIds.length,
            target: { storageIds: deletedStorageIds },
        }
    }

    private _benchmarkDeleteCellsLocally(storageIds: number[]): Promise<void> {
        return new Promise(resolve => {
            this.patchCore.deleteCellsLocally(storageIds, (infos: [sourceStorageIds: number[], targetStorageIds: number[]]) => {
                for (let i = 0; i < infos[0].length; i++) {
                    this.copyGPUCell(infos[0][i], infos[1][i])
                }
                this.map.triggerRepaint()
                resolve()
            })
        })
    }

    private _benchmarkSubdivideCells(subdivideInfos: { levels: Uint8Array, globalIds: Uint32Array }): Promise<number[]> {
        return new Promise(resolve => {
            this.patchCore.subdivideCells(subdivideInfos, (renderInfos: [number, Uint8Array, Float32Array, Float32Array, Uint8Array]) => {
                this.updateGPUCells(renderInfos)
                const [fromStorageId, levels] = renderInfos
                const storageIds = Array.from(
                    { length: levels.length },
                    (_, i) => fromStorageId + i
                )
                this._hit(storageIds)
                resolve(storageIds)
            })
        })
    }

    private _benchmarkMergeCells(mergeableStorageIds: number[]): Promise<number[]> {
        return new Promise((resolve, reject) => {
            this.patchCore.mergeCells(mergeableStorageIds, (info: { childStorageIds: number[], parentInfo: MultiCellBaseInfo }) => {
                if (info.parentInfo.levels.length === 0) {
                    reject(new Error('Selected benchmark cells are not mergeable'))
                    return
                }

                this.patchCore.deleteCellsLocally(info.childStorageIds, (infos: [sourceStorageIds: number[], targetStorageIds: number[]]) => {
                    for (let i = 0; i < infos[0].length; i++) {
                        this.copyGPUCell(infos[0][i], infos[1][i])
                    }

                    const fromStorageId = this.patchCore.cellNum
                    this.patchCore.updateMultiCellRenderInfo(info.parentInfo, (renderInfo: [number, Uint8Array, Float32Array, Float32Array, Uint8Array]) => {
                        this.updateGPUCells(renderInfo)
                        const [, levels] = renderInfo
                        const storageIds = Array.from(
                            { length: levels.length },
                            (_, i) => fromStorageId + i
                        )
                        this._hit(storageIds)
                        resolve(storageIds)
                    })
                })
            })
        })
    }

    private _benchmarkMarkCellsAsDeleted(storageIds: number[]): Promise<void> {
        return new Promise(resolve => this.patchCore.markCellsAsDeleted(storageIds, () => { this._hit(storageIds); resolve() }))
    }

    private _benchmarkRestoreCells(storageIds: number[]): Promise<void> {
        return new Promise(resolve => this.patchCore.restoreCells(storageIds, () => { this._hit(storageIds); resolve() }))
    }

    private _findBenchmarkMergeGroup(trialIndex: number): number[] {
        void trialIndex
        const key = this._completeMergeGroups.values().next().value
        return key === undefined ? [] : [...this._mergeGroups.get(key)!.ids]
    }

    private _findBenchmarkStorageId(trialIndex: number, predicate: (id: number) => boolean, subdividable = false): number | null {
        void trialIndex
        const candidates = subdividable ? this._subdividableIds : this._activeIds
        const id = candidates.values().next().value
        if (id === undefined) return null
        if (!predicate(id)) throw new Error('Stale benchmark candidate index')
        // Round-robin eligible originals without scanning the loaded topology.
        candidates.delete(id)
        candidates.add(id)
        return id
    }

    private trackCell(cell: DisplayCell, add: boolean): void {
        if (cell.deleted) return
        const core = this.patchCore
        if (add) this._activeIds.add(cell.id)
        else this._activeIds.delete(cell.id)
        if (cell.level < core.maxLevel) {
            if (add) this._subdividableIds.add(cell.id)
            else this._subdividableIds.delete(cell.id)
        }
        if (cell.level === 0) return
        const parent = core.levelInfos[cell.level - 1]
        const rule = core.context.rules[cell.level - 1]
        // Floor in child lattice coordinates to avoid rounding a sibling into
        // the next parent when its local coordinate lies past the midpoint.
        const level = core.levelInfos[cell.level]
        const childU = Math.round((cell.bounds[0] - core.bBox.xMin) / ((core.bBox.xMax - core.bBox.xMin) / level.width))
        const childV = Math.round((cell.bounds[1] - core.bBox.yMin) / ((core.bBox.yMax - core.bBox.yMin) / level.height))
        const key = `${cell.level - 1}:${Math.floor(childV / rule[1]) * parent.width + Math.floor(childU / rule[0])}`
        let group = this._mergeGroups.get(key)
        if (add) {
            if (!group) { group = { ids: new Set(), required: rule[0] * rule[1] }; this._mergeGroups.set(key, group) }
            group.ids.add(cell.id)
        } else group?.ids.delete(cell.id)
        if (group && group.ids.size === group.required) this._completeMergeGroups.add(key)
        else this._completeMergeGroups.delete(key)
        if (group && !group.ids.size) this._mergeGroups.delete(key)
    }

    private _getBenchmarkTargetMetadata(storageId: number): Record<string, unknown> {
        const [level, globalId] = this.patchCore.getInfoByStorageId(storageId)
        return {
            storageId,
            level,
            globalId,
            deleted: this.patchCore.isDeleted(storageId),
        }
    }

    private _waitForBenchmarkRenderFrame(timeoutMs = BENCHMARK_RENDER_FRAME_TIMEOUT_MS): Promise<TopologyRenderSample> {
        return new Promise((resolve, reject) => {
            let timeoutId = 0
            const unsubscribe = this.addRenderSampleListener(sample => {
                if (timeoutId) window.clearTimeout(timeoutId)
                unsubscribe()
                resolve(sample)
            })
            if (timeoutMs > 0) {
                timeoutId = window.setTimeout(() => {
                    unsubscribe()
                    reject(new Error('Timed out waiting for benchmark render frame'))
                }, timeoutMs)
            }
            this.map.triggerRepaint()
        })
    }


    show(): void { this.visible = true; if (this._overlayCanvas) this._overlayCanvas.style.display = 'block'; this.requestView() }
    hide(): void {
        this.visible = false
        this.cancelView()
        this._buffers?.clear()
        this._view = { chunks: [], cellCount: this._view.cellCount }
        if (this._overlayCanvas) this._overlayCanvas.style.display = 'none'
        this.emitStats()
        this.map.triggerRepaint()
    }
    private cancelView(): void {
        if (this._cameraFrame !== undefined) cancelAnimationFrame(this._cameraFrame)
        this._cameraFrame = undefined
        this._scheduled = undefined
        this._request?.abort()
        this._request = undefined
        this._viewPromise = undefined
        this._pendingView = false
        this._forceView = false
        this._lastCamera = undefined
        this._blocks = []
        this._loading = false
    }
    private detachSource(): void {
        this.cancelView()
        this._generation++
        this._unsubscribePatch?.()
        this._unsubscribePatch = undefined
        this._patchCore = null
        this._source = undefined
        this._index = undefined
        this._selectionIndex = undefined
        this._projection = undefined
        this._dataReady = false
        this._loading = false
        this._view = { chunks: [], cellCount: 0 }
        this.hitBuffer.clear()
        this._selectionVersions.clear()
        this._activeIds.clear()
        this._subdividableIds.clear()
        this._mergeGroups.clear()
        this._completeMergeGroups.clear()
        this._benchmarkSubdivideChildGroups.clear()
        this._benchmarkDeletedGroups.clear()
        this._buffers?.clear()
        this.emitStats()
    }
    private releaseGPU(): void {
        this._gpuEpoch++
        this._buffers?.clear()
        this._buffers = undefined
        if (this._palette) this._gl.deleteTexture(this._palette)
        if (this._program) this._gl.deleteProgram(this._program)
        this._palette = null
        this._program = null
        this._textureBytes = 0
        this.initialized = false
        this._gpuInitPromise = undefined
    }
    removeResource(): void { this.detachSource(); this.map.triggerRepaint() }
    remove(map: MapboxMap, gl: WebGL2RenderingContext): void {
        void map
        void gl
        const core = this._patchCore
        this._removed = true
        this.detachSource()
        this.releaseGPU()
        core?.remove()
        for (const event of CAMERA_EVENTS) this.map.off(event, this._cameraChanged)
        this.map.getCanvas().removeEventListener('webglcontextlost', this._contextLost)
        this.map.getCanvas().removeEventListener('webglcontextrestored', this._contextRestored)
        window.removeEventListener('keydown', this._keyDown)
        this._resizeObserver?.disconnect()
        gridDisplayI18n.off('languageChanged', this._updateFieldIndicator)
        this._fieldIndicator?.remove()
        this._fieldIndicator = null
        this._overlayCanvas?.remove()
        this._overlayCanvas = null
        this._overlayCtx = null
        this.emitStats()
    }
    private resizeOverlay(): void {
        if (!this._overlayCanvas) return
        const rect = this.map.getContainer().getBoundingClientRect()
        this._overlayCanvas.width = rect.width
        this._overlayCanvas.height = rect.height
    }
    executeDrawBox(start: [number, number], end: [number, number]): void {
        const ctx = this._overlayCtx
        if (!ctx || !this._overlayCanvas) return
        this.executeClearDrawBox()
        ctx.strokeStyle = 'rgba(227, 102, 0, 0.67)'
        ctx.fillStyle = 'rgba(235, 190, 148, 0.52)'
        ctx.lineWidth = 2
        ctx.setLineDash([5, 3])
        ctx.fillRect(Math.min(start[0], end[0]), Math.min(start[1], end[1]), Math.abs(start[0] - end[0]), Math.abs(start[1] - end[1]))
        ctx.strokeRect(Math.min(start[0], end[0]), Math.min(start[1], end[1]), Math.abs(start[0] - end[0]), Math.abs(start[1] - end[1]))
    }
    executeClearDrawBox(): void { if (this._overlayCanvas) this._overlayCtx?.clearRect(0, 0, this._overlayCanvas.width, this._overlayCanvas.height) }
    setCheckMode(checking: boolean): void { void checking; this.executeClearSelection() }
}

function createProgram(gl: WebGL2RenderingContext, source: string): WebGLProgram {
    const shaders: WebGLShader[] = []
    const program = gl.createProgram()
    if (!program) throw new Error('Unable to create grid shader program')
    try {
        for (const [stage, define] of [[gl.VERTEX_SHADER, 'VERTEX_SHADER'], [gl.FRAGMENT_SHADER, 'FRAGMENT_SHADER']] as const) {
            const shader = gl.createShader(stage)
            if (!shader) throw new Error('Unable to create grid shader')
            shaders.push(shader)
            gl.shaderSource(shader, `#version 300 es\n#define ${define}\n${source}`)
            gl.compileShader(shader)
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Grid shader compilation failed')
            gl.attachShader(program, shader)
        }
        gl.linkProgram(program)
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Grid shader linking failed')
        return program
    } catch (error) { gl.deleteProgram(program); throw error }
    finally { for (const shader of shaders) gl.deleteShader(shader) }
}

/** Preserve chunk identity across JSON responses when immutable content agrees. */
function reuseChunks(previous: GridDisplayView, next: GridDisplayView): GridDisplayView {
    const cached = new Map(previous.chunks.map(chunk => [chunk.key, chunk]))
    const equalBounds = (a: Bounds, b: Bounds) => a.every((value, index) => value === b[index])
    const equalSample = (a: DisplayCell | DisplayField, b: DisplayCell | DisplayField) =>
        equalBounds(a.bounds, b.bounds) && a.level === b.level && a.elevation === b.elevation && a.landClass === b.landClass
        && ('id' in a && 'id' in b ? a.id === b.id && a.deleted === b.deleted
            : 'occupiedFraction' in a && 'occupiedFraction' in b && a.occupiedFraction === b.occupiedFraction && a.minCellSize === b.minCellSize)
    return { cellCount: next.cellCount, chunks: next.chunks.map(chunk => {
        const old = cached.get(chunk.key)
        return old && equalBounds(old.bounds, chunk.bounds) && old.cells.length === chunk.cells.length && old.fields.length === chunk.fields.length
            && old.cells.every((cell, index) => equalSample(cell, chunk.cells[index]))
            && old.fields.every((field, index) => equalSample(field, chunk.fields[index])) ? old : chunk
    }) }
}
