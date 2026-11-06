import type {
    Bounds, DisplayBlock, DisplayCell, DisplayChunk, DisplayField, DisplayLayer, GridDisplayMeta, GridDisplayView, GridInspection,
} from './displayTypes'
import { AreaSummary, cellSide, containsPoint, intersectionArea, intersects, validBounds } from './displayMath'
import { axisIndex, blockKey, displayLayer, displayLayers, nodeBounds, selectDisplayBlocks } from './displayHierarchy'

const CHUNK_SIZE = 64
const MAX_CACHED_CHUNKS = 768

type Schema = Partial<Pick<GridDisplayMeta, 'grid_info' | 'level_info' | 'alignment_origin'>>
interface CellTile { x: number; y: number; ids: Set<number> }
interface LevelStore { level: number; width: number; height: number; tiles: Map<string, CellTile> }
interface SummaryNode {
    x: number
    y: number
    layer: number
    all: AreaSummary
    live: AreaSummary
    original?: DisplayCell
    hasDeleted: boolean
    children: SummaryNode[]
    /** Last node on a unary path, so sparse queries do not walk empty depth per output. */
    jump?: SummaryNode
}
interface CachedChunk { chunk: DisplayChunk; revision: number; block?: string }
function tileKey(x: number, y: number): string { return `${x},${y}` }

/** The same native/dyadic hierarchy as the server. An edit changes one ancestor path. */
export default class DisplayIndex {
    readonly bounds: Bounds
    readonly displayLayers: DisplayLayer[]
    readonly origin: [number, number]
    queryVisits = 0
    updateVisits = 0
    private readonly cells = new Map<number, DisplayCell>()
    private readonly levels = new Map<number, LevelStore>()
    private readonly nodes: Map<string, SummaryNode>[]
    private readonly nativeLayers = new Map<number, number>()
    private readonly classUnits = new Map<number, bigint>()
    private readonly chunks = new Map<string, CachedChunk>()
    private readonly blockCaches = new Map<string, Set<string>>()
    private readonly edgeIds = new Map<string, number>()
    private readonly edgeKeys = new Map<number, string>()
    private nextRevision = 1
    private readonly originX: number
    private readonly originY: number
    private readonly unitX: number
    private readonly unitY: number

    constructor(bounds: Bounds, schema: Schema) {
        if (!validBounds(bounds)) throw new Error('Invalid display index bounds')
        this.bounds = [...bounds]
        this.origin = schema.alignment_origin ?? [bounds[0], bounds[1]]
        ;[this.originX, this.originY] = this.origin
        if (!this.origin.every(Number.isFinite)) throw new Error('Invalid display alignment origin')
        const sizes: [number, number][] = schema.grid_info ?? schema.level_info?.map(info => [
            (bounds[2] - bounds[0]) / info.width, (bounds[3] - bounds[1]) / info.height,
        ]) ?? []
        this.displayLayers = displayLayers(bounds, sizes, this.origin)
        this.nodes = this.displayLayers.map(() => new Map())
        let units = 1n
        for (let i = sizes.length - 1; i >= 0; i--) {
            if (i + 1 < sizes.length) units *= BigInt(Math.round(sizes[i][0] / sizes[i + 1][0])) * BigInt(Math.round(sizes[i][1] / sizes[i + 1][1]))
            this.classUnits.set(i, units)
        }
        this.unitX = sizes[sizes.length - 1][0]
        this.unitY = sizes[sizes.length - 1][1]
        this.displayLayers.forEach((layer, i) => {
            if (layer.nativeLevel !== null) {
                this.nativeLayers.set(layer.nativeLevel, i)
                this.levels.set(layer.nativeLevel, { level: layer.nativeLevel, width: layer.width, height: layer.height, tiles: new Map() })
            }
        })
    }

    /** Initial build visits each stored node and its sparse class entries once, bottom-up. */
    load(cells: Iterable<DisplayCell>): void {
        if (this.cells.size) throw new Error('Initial display load requires an empty index')
        for (const input of cells) {
            const cell = this.checkedCell(input)
            if (this.cells.has(cell.id)) throw new Error('Duplicate display cell ID')
            const layer = this.nativeLayers.get(cell.level)!
            const [x, y] = this.locate(layer, (cell.bounds[0] + cell.bounds[2]) / 2, (cell.bounds[1] + cell.bounds[3]) / 2)
            const node = this.node(layer, x, y)
            if (node.original) throw new Error('Duplicate display cell geometry')
            node.original = cell
            node.all.addCell(cell, (cell.bounds[2] - cell.bounds[0]) * (cell.bounds[3] - cell.bounds[1]), 1, this.classUnits.get(cell.level)!)
            if (cell.deleted) node.live = new AreaSummary(false)
            this.storeCell(cell, true)
        }
        for (let i = 0; i < this.nodes.length; i++) {
            for (const node of this.nodes[i].values()) {
                this.refreshSummary(node)
                if (i + 1 === this.nodes.length) continue
                const [x, y] = this.parentCoordinates(node)
                const parent = this.node(i + 1, x, y)
                if (parent.original) throw new Error('Overlapping coarse and fine display cells')
                parent.children.push(node)
                if (node.live !== node.all && parent.live === parent.all) parent.live = parent.all.clone()
                parent.all.addSummary(node.all)
                if (parent.live !== parent.all) parent.live.addSummary(node.live)
            }
        }
    }

    upsert(input: DisplayCell): void {
        const cell = this.checkedCell(input)
        this.updateVisits = 0
        const old = this.cells.get(cell.id)
        if (old) this.change(old, -1)
        this.change(cell, 1)
    }

    remove(id: number): void {
        this.updateVisits = 0
        const cell = this.cells.get(id)
        if (cell) this.change(cell, -1)
    }

    getCell(id: number): DisplayCell | undefined { return this.cells.get(id) }

    /** Selection opacity is queried on the exact same display node, without leaf descent. */
    summarize(bounds: Bounds, showDeleted = true): DisplayField | null {
        if (!validBounds(bounds)) throw new Error('Invalid summary bounds')
        for (let i = 0; ; i++) {
            const layer = this.layer(i)
            if (i >= this.displayLayers.length && (layer.width > (bounds[2] - bounds[0]) * (1 + 1e-12)
                || layer.height > (bounds[3] - bounds[1]) * (1 + 1e-12))) break
            const [x, y] = this.locate(i, bounds[0], bounds[1])
            const b = nodeBounds(layer, x, y, this.origin)
            if (b.every((v, k) => Math.abs(v - bounds[k]) < Math.max(1, Math.abs(v)) * 1e-12)) {
                this.ensureLayer(i)
                const node = this.nodes[i].get(tileKey(x, y))
                if (node) return (showDeleted ? node.all : node.live).toField(bounds)
                for (let j = i + 1; j < this.displayLayers.length; j++) {
                    const [cx, cy] = this.locate(j, (bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2)
                    const cell = this.nodes[j].get(tileKey(cx, cy))?.original
                    if (cell && (showDeleted || !cell.deleted)) {
                        const summary = new AreaSummary()
                        summary.addCell(cell, intersectionArea(bounds, cell.bounds), 1, this.classUnits.get(cell.level)!)
                        return summary.toField(bounds)
                    }
                }
                return null
            }
        }
        throw new Error('Selection summary must address a display node')
    }

    query(bounds: Bounds, metersPerPixel: number, showDeleted = true): GridDisplayView {
        if (!validBounds(bounds) || !(metersPerPixel > 0) || !Number.isFinite(metersPerPixel)) throw new Error('Invalid display query')
        return this.queryBlocks(selectDisplayBlocks(this.displayLayers, this.origin, bounds, ([x, y]) => [x / metersPerPixel, y / metersPerPixel]), showDeleted)
    }

    queryBlocks(blocks: DisplayBlock[], showDeleted = true): GridDisplayView {
        this.queryVisits = 0
        const chunks: DisplayChunk[] = []
        const originals = new Set<number>()
        for (const block of blocks) {
            const { blockLayer: i, x, y, displayLayer } = block
            if (!Number.isSafeInteger(i) || !Number.isSafeInteger(displayLayer) || displayLayer < 0 || displayLayer > i
                || !Number.isSafeInteger(x) || !Number.isSafeInteger(y)) throw new Error('Invalid display block')
            const layer = this.layer(i)
            if (x < layer.x0 || x >= layer.x0 + layer.nx || y < layer.y0 || y >= layer.y0 + layer.ny) throw new Error('Display block outside grid')
            this.ensureLayer(i)
            const bounds = nodeBounds(layer, x, y, this.origin)
            let enclosing: DisplayCell | undefined
            for (let j = i + 1; j < this.displayLayers.length; j++) {
                const [cx, cy] = this.locate(j, (bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2)
                this.queryVisits++
                const cell = this.nodes[j].get(tileKey(cx, cy))?.original
                if (cell) { enclosing = cell; break }
            }
            if (enclosing) {
                if ((showDeleted || !enclosing.deleted) && !originals.has(enclosing.id)) {
                    originals.add(enclosing.id)
                    chunks.push(this.cached(`original:${enclosing.id}`, () => ({ key: '', bounds: enclosing!.bounds, cells: [enclosing!], fields: [] })))
                }
                continue
            }
            const key = `${blockKey(block)}:${showDeleted ? 1 : 0}`
            const chunk = this.cached(key, () => {
                const cells: DisplayCell[] = [], fields: DisplayField[] = []
                const visit = (node: SummaryNode) => {
                    this.queryVisits++
                    const summary = showDeleted ? node.all : node.live
                    if (summary.occupiedArea <= 0) return
                    if (node.original) { cells.push(node.original); return }
                    if (node.layer === displayLayer) {
                        fields.push(summary.toField(nodeBounds(this.layer(node.layer), node.x, node.y, this.origin))!)
                    } else if (node.jump) {
                        if (node.jump.layer >= displayLayer) visit(node.jump)
                        else {
                            const b = nodeBounds(this.layer(node.jump.layer), node.jump.x, node.jump.y, this.origin)
                            const [cx, cy] = this.locate(displayLayer, (b[0] + b[2]) / 2, (b[1] + b[3]) / 2)
                            visit(this.nodes[displayLayer].get(tileKey(cx, cy))!)
                        }
                    } else for (const child of node.children) visit(child)
                }
                const root = this.nodes[i].get(tileKey(x, y))
                if (root) visit(root)
                return { key, bounds, cells, fields }
            }, `${i}:${x}:${y}`)
            if (chunk.cells.length || chunk.fields.length) chunks.push(chunk)
        }
        this.trimCache(chunks)
        return { chunks, cellCount: this.cells.size }
    }

    inspect(x: number, y: number, showDeleted = true): GridInspection {
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Invalid inspection point')
        if (!containsPoint(this.bounds, x, y)) return { cell: null, neighbors: [] }
        const candidates = new Map<number, DisplayCell>()
        for (const store of this.levels.values()) {
            const tx = Math.floor((x - this.originX) / (store.width * CHUNK_SIZE))
            const ty = Math.floor((y - this.originY) / (store.height * CHUNK_SIZE))
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                for (const id of store.tiles.get(tileKey(tx + dx, ty + dy))?.ids ?? []) {
                    const cell = this.cells.get(id)!
                    if ((showDeleted || !cell.deleted) && containsPoint(cell.bounds, x, y)) candidates.set(id, cell)
                }
            }
        }
        const cell = [...candidates.values()].sort((a, b) =>
            cellSide(a) - cellSide(b) || a.id - b.id)[0] ?? null
        if (!cell) return { cell: null, neighbors: [] }
        const neighbors: GridInspection['neighbors'] = []
        for (const side of ['west', 'east', 'south', 'north'] as const) {
            const touching = this.sideCandidates(cell, side, showDeleted)
            for (const other of touching) {
                const vertical = side === 'west' || side === 'east'
                const from = vertical
                    ? Math.max(cell.bounds[1], other.bounds[1])
                    : Math.max(cell.bounds[0], other.bounds[0])
                const to = vertical
                    ? Math.min(cell.bounds[3], other.bounds[3])
                    : Math.min(cell.bounds[2], other.bounds[2])
                const coordinate = vertical
                    ? (side === 'west' ? cell.bounds[0] : cell.bounds[2])
                    : (side === 'south' ? cell.bounds[1] : cell.bounds[3])
                neighbors.push({ side, cell: other, edgeIds: [this.edgeId(vertical, coordinate, from, to)] })
            }
        }
        return { cell, neighbors }
    }

    selectBounds(bounds: Bounds, showDeleted = true): number[] {
        if (!validBounds(bounds)) throw new Error('Invalid selection bounds')
        const selected = new Set<number>()
        for (const store of this.levels.values()) {
            this.visitTiles(store, bounds, tile => {
                for (const id of tile.ids) {
                    const cell = this.cells.get(id)!
                    if ((showDeleted || !cell.deleted) && intersects(cell.bounds, bounds)) selected.add(id)
                }
            })
        }
        return [...selected].sort((a, b) => a - b)
    }

    getChunkRevision(key: string): number { return this.chunks.get(key)?.revision ?? 0 }

    private checkedCell(input: DisplayCell): DisplayCell {
        const layerIndex = this.nativeLayers.get(input.level)
        if (!validBounds(input.bounds) || !Number.isSafeInteger(input.id) || input.id < 0 || layerIndex === undefined || !Number.isFinite(input.elevation) || !Number.isSafeInteger(input.landClass) || input.landClass < 0) throw new Error('Invalid display cell')
        const layer = this.displayLayers[layerIndex]
        const b = input.bounds
        const ix = Math.round((b[0] - this.originX) / layer.width)
        const iy = Math.round((b[1] - this.originY) / layer.height)
        const expected = nodeBounds(layer, ix, iy, this.origin)
        if (b.some((v, i) => Math.abs(v - expected[i]) > Math.max(1, Math.abs(v)) * 1e-10) || b[0] < this.bounds[0] - 1e-7 || b[1] < this.bounds[1] - 1e-7 || b[2] > this.bounds[2] + 1e-7 || b[3] > this.bounds[3] + 1e-7) throw new Error('Display cell does not match its schema level')
        return { ...input, bounds: [...input.bounds] }
    }

    private locate(i: number, x: number, y: number): [number, number] {
        const layer = this.layer(i)
        return [axisIndex(x - this.originX, layer.width, layer.xLayout), axisIndex(y - this.originY, layer.height, layer.yLayout)]
    }

    private node(layer: number, x: number, y: number): SummaryNode {
        const key = tileKey(x, y)
        let node = this.nodes[layer].get(key)
        if (!node) {
            const all = new AreaSummary(false)
            node = { x, y, layer, all, live: all, children: [], hasDeleted: false }
            this.nodes[layer].set(key, node)
        }
        return node
    }

    private parentCoordinates(node: SummaryNode): [number, number] {
        if (node.layer >= this.displayLayers.length - 1) return [Math.floor(node.x / 2), Math.floor(node.y / 2)]
        const b = nodeBounds(this.layer(node.layer), node.x, node.y, this.origin)
        return this.locate(node.layer + 1, (b[0] + b[2]) / 2, (b[1] + b[3]) / 2)
    }

    private layer(index: number): DisplayLayer { return displayLayer(this.displayLayers, index) }

    /** Extend only the at-most-four storage roots; never rebuild the fine tree. */
    private ensureLayer(index: number): void {
        for (let i = this.nodes.length; i <= index; i++) {
            this.nodes.push(new Map())
            for (const child of this.nodes[i - 1].values()) {
                const [x, y] = this.parentCoordinates(child)
                const parent = this.node(i, x, y)
                parent.children.push(child)
                if (child.live !== child.all && parent.live === parent.all) parent.live = parent.all.clone()
                parent.all.addSummary(child.all)
                if (parent.live !== parent.all) parent.live.addSummary(child.live)
            }
            for (const parent of this.nodes[i].values()) this.refreshSummary(parent)
        }
    }

    private storeCell(cell: DisplayCell, add: boolean): void {
        const store = this.levels.get(cell.level)!
        const x = Math.floor(Math.round((cell.bounds[0] - this.originX) / store.width) / CHUNK_SIZE)
        const y = Math.floor(Math.round((cell.bounds[1] - this.originY) / store.height) / CHUNK_SIZE)
        const key = tileKey(x, y)
        if (add) {
            this.cells.set(cell.id, cell)
            let tile = store.tiles.get(key)
            if (!tile) { tile = { x, y, ids: new Set() }; store.tiles.set(key, tile) }
            tile.ids.add(cell.id)
        } else {
            this.cells.delete(cell.id)
            const tile = store.tiles.get(key)!
            tile.ids.delete(cell.id)
            if (!tile.ids.size) store.tiles.delete(key)
        }
    }

    private change(cell: DisplayCell, sign: 1 | -1): void {
        const first = this.nativeLayers.get(cell.level)!
        let [x, y] = this.locate(first, (cell.bounds[0] + cell.bounds[2]) / 2, (cell.bounds[1] + cell.bounds[3]) / 2)
        let child: SummaryNode | undefined
        const signedUnits = this.classUnits.get(cell.level)! * BigInt(sign)
        for (let i = first; i < this.nodes.length; i++) {
            const node = sign === 1 ? this.node(i, x, y) : this.nodes[i].get(tileKey(x, y))!
            this.updateVisits++
            if (i === first) node.original = sign === 1 ? cell : undefined
            if (child) {
                const found = node.children.indexOf(child)
                if (child.all.occupiedArea > 0 && found < 0) node.children.push(child)
                if (child.all.occupiedArea <= 0 && found >= 0) node.children.splice(found, 1)
            }
            if (cell.deleted && node.live === node.all) node.live = node.all.clone()
            node.all.updateClass(cell.landClass, signedUnits)
            if (!cell.deleted && node.live !== node.all) node.live.updateClass(cell.landClass, signedUnits)
            this.refreshSummary(node)
            if (!node.hasDeleted) node.live = node.all
            const cacheKey = `${i}:${x}:${y}`
            for (const key of this.blockCaches.get(cacheKey) ?? []) this.uncache(key)
            if (node.all.occupiedArea === 0) this.nodes[i].delete(tileKey(x, y))
            child = node
            if (i + 1 < this.nodes.length) [x, y] = this.parentCoordinates(node)
        }
        this.uncache(`original:${cell.id}`)
        this.storeCell(cell, sign === 1)
    }

    private refreshSummary(node: SummaryNode): void {
        for (const summary of node.live === node.all ? [node.all] : [node.all, node.live]) {
            const live = summary === node.live && summary !== node.all
            const original = node.original && (!live || !node.original.deleted) ? node.original : undefined
            summary.occupiedArea = original ? (original.bounds[2] - original.bounds[0]) * (original.bounds[3] - original.bounds[1]) : 0
            summary.elevationArea = original ? original.elevation * summary.occupiedArea : 0
            summary.minCellSize = node.original && (!live || !node.original.deleted) ? cellSide(node.original) : Infinity
            summary.finestLevel = node.original && (!live || !node.original.deleted) ? node.original.level : -Infinity
            for (const child of node.children) {
                const value = live ? child.live : child.all
                summary.occupiedArea += value.occupiedArea
                summary.elevationArea += value.elevationArea
                summary.minCellSize = Math.min(summary.minCellSize, value.minCellSize)
                summary.finestLevel = Math.max(summary.finestLevel, value.finestLevel)
            }
        }
        node.hasDeleted = !!node.original?.deleted || node.children.some(child => child.hasDeleted)
        node.jump = node.children.length === 1 ? node.children[0].jump ?? node.children[0] : undefined
    }

    private cached(key: string, build: () => DisplayChunk, block?: string): DisplayChunk {
        const old = this.chunks.get(key)
        if (old) { this.chunks.delete(key); this.chunks.set(key, old); return old.chunk }
        const chunk = build()
        chunk.key = key
        this.chunks.set(key, { chunk, revision: this.nextRevision++, block })
        if (block) {
            const keys = this.blockCaches.get(block) ?? new Set<string>()
            keys.add(key)
            this.blockCaches.set(block, keys)
        }
        return chunk
    }

    private uncache(key: string): void {
        const entry = this.chunks.get(key)
        this.chunks.delete(key)
        if (entry?.block) {
            const keys = this.blockCaches.get(entry.block)!
            keys.delete(key)
            if (!keys.size) this.blockCaches.delete(entry.block)
        }
    }

    private trimCache(visible: DisplayChunk[]): void {
        const keys = new Set(visible.map(chunk => chunk.key))
        const budget = Math.max(MAX_CACHED_CHUNKS, keys.size)
        for (const key of this.chunks.keys()) {
            if (this.chunks.size <= budget) break
            if (!keys.has(key)) this.uncache(key)
        }
    }

    private visitTiles(store: LevelStore, bounds: Bounds, visit: (tile: CellTile) => void): void {
        const width = store.width * CHUNK_SIZE
        const height = store.height * CHUNK_SIZE
        // Include boundary tiles so floating-point CRS coordinates cannot omit a touching cell.
        const x0 = Math.floor((bounds[0] - this.originX) / width) - 1
        const x1 = Math.floor((bounds[2] - this.originX) / width) + 1
        const y0 = Math.floor((bounds[1] - this.originY) / height) - 1
        const y1 = Math.floor((bounds[3] - this.originY) / height) + 1
        if ((x1 - x0 + 1) * (y1 - y0 + 1) > store.tiles.size * 2) {
            for (const tile of store.tiles.values()) {
                if (x0 <= tile.x && tile.x <= x1 && y0 <= tile.y && tile.y <= y1) {
                    this.queryVisits++
                    visit(tile)
                }
            }
        } else {
            for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
                this.queryVisits++
                const tile = store.tiles.get(tileKey(x, y))
                if (tile) visit(tile)
            }
        }
    }

    private sideCandidates(cell: DisplayCell, side: 'west' | 'east' | 'south' | 'north',
        showDeleted: boolean): DisplayCell[] {
        const found = new Map<number, DisplayCell>()
        const vertical = side === 'west' || side === 'east'
        const line = vertical
            ? (side === 'west' ? cell.bounds[0] : cell.bounds[2])
            : (side === 'south' ? cell.bounds[1] : cell.bounds[3])
        for (const store of this.levels.values()) {
            const tileWidth = store.width * CHUNK_SIZE
            const tileHeight = store.height * CHUNK_SIZE
            const x0 = vertical
                ? Math.floor((line - this.originX) / tileWidth) - 1
                : Math.floor((cell.bounds[0] - this.originX) / tileWidth) - 1
            const x1 = vertical
                ? Math.floor((line - this.originX) / tileWidth) + 1
                : Math.floor((cell.bounds[2] - this.originX) / tileWidth) + 1
            const y0 = vertical
                ? Math.floor((cell.bounds[1] - this.originY) / tileHeight) - 1
                : Math.floor((line - this.originY) / tileHeight) - 1
            const y1 = vertical
                ? Math.floor((cell.bounds[3] - this.originY) / tileHeight) + 1
                : Math.floor((line - this.originY) / tileHeight) + 1
            for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
                for (const id of store.tiles.get(tileKey(tx, ty))?.ids ?? []) {
                    if (id === cell.id) continue
                    const other = this.cells.get(id)!
                    if (!showDeleted && other.deleted) continue
                    const b = other.bounds
                    const sameX = (value: number) =>
                        Math.round((value - this.originX) / this.unitX) ===
                        Math.round((line - this.originX) / this.unitX)
                    const sameY = (value: number) =>
                        Math.round((value - this.originY) / this.unitY) ===
                        Math.round((line - this.originY) / this.unitY)
                    const touches = side === 'west'
                        ? sameX(b[2]) && Math.min(b[3], cell.bounds[3]) > Math.max(b[1], cell.bounds[1])
                        : side === 'east'
                            ? sameX(b[0]) && Math.min(b[3], cell.bounds[3]) > Math.max(b[1], cell.bounds[1])
                            : side === 'south'
                                ? sameY(b[3]) && Math.min(b[2], cell.bounds[2]) > Math.max(b[0], cell.bounds[0])
                                : sameY(b[1]) && Math.min(b[2], cell.bounds[2]) > Math.max(b[0], cell.bounds[0])
                    if (touches) found.set(id, other)
                }
            }
        }
        return [...found.values()].sort((a, b) => a.bounds[1] - b.bounds[1] || a.bounds[0] - b.bounds[0] || a.id - b.id)
    }

    private edgeId(vertical: boolean, coordinate: number, from: number, to: number): number {
        const axisOrigin = vertical ? this.originX : this.originY
        const axisUnit = vertical ? this.unitX : this.unitY
        const lengthOrigin = vertical ? this.originY : this.originX
        const lengthUnit = vertical ? this.unitY : this.unitX
        const key = `${vertical ? 'v' : 'h'}:${Math.round((coordinate - axisOrigin) / axisUnit)}:` +
            `${Math.round((from - lengthOrigin) / lengthUnit)}:${Math.round((to - lengthOrigin) / lengthUnit)}`
        let id = this.edgeIds.get(key)
        if (!id) {
            let hash = 14695981039346656037n
            for (let i = 0; i < key.length; i++) {
                hash ^= BigInt(key.charCodeAt(i))
                hash = (hash * 1099511628211n) & 0xffffffffffffffffn
            }
            id = Number(hash & 0x1fffffffffffffn) || 1
            while (this.edgeKeys.has(id) && this.edgeKeys.get(id) !== key) {
                id = id === Number.MAX_SAFE_INTEGER ? 1 : id + 1
            }
            this.edgeIds.set(key, id)
            this.edgeKeys.set(id, key)
        }
        return id
    }
}
