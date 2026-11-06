import type {
    Bounds, DisplayCell, DisplayChunk, DisplayField, GridDisplayMeta, GridDisplayView, GridInspection,
} from './displayTypes'
import {
    AreaSummary, CELL_PIXEL_THRESHOLD, cellSide, containsPoint, intersects, sampleStep, validBounds,
} from './displayMath'

const CHUNK_SIZE = 64
const MAX_CACHED_CHUNKS = 768

type Schema = Partial<Pick<GridDisplayMeta, 'grid_info' | 'level_info' | 'alignment_origin'>>

interface YNode {
    lo: number
    hi: number
    all: AreaSummary
    live: AreaSummary
    directAll?: AreaSummary
    directLive?: AreaSummary
    left?: YNode
    right?: YNode
}

interface XNode {
    lo: number
    hi: number
    total?: YNode
    direct?: YNode
    left?: XNode
    right?: XNode
}

interface CellTile {
    x: number
    y: number
    ids: Set<number>
}

interface LevelStore {
    level: number
    width: number
    height: number
    widthUnits: number
    heightUnits: number
    root: XNode
    tiles: Map<string, CellTile>
}

interface CachedChunk {
    chunk: DisplayChunk
    bounds: Bounds
    level?: number
    fineLevels?: number[]
    revision: number
}

function tileKey(x: number, y: number): string {
    return `${x},${y}`
}

function makeY(lo: number, hi: number, cell: DisplayCell): YNode {
    const side = cellSide(cell)
    const all = new AreaSummary(side, cell.level)
    return {
        lo, hi, all, live: all,
    }
}

const EMPTY_SUMMARY = new AreaSummary()

function summary(node: YNode, showDeleted: boolean, direct: boolean): AreaSummary {
    return direct
        ? (showDeleted ? node.directAll ?? EMPTY_SUMMARY : node.directLive ?? EMPTY_SUMMARY)
        : (showDeleted ? node.all : node.live)
}

function axisRange(bounds: Bounds, axis: 0 | 1, origin: number, unit: number): [number, number] {
    const lo = Math.floor((bounds[axis] - origin) / unit)
    const hi = Math.ceil((bounds[axis + 2] - origin) / unit)
    const size = 2 ** Math.ceil(Math.log2(Math.max(1, hi - lo)))
    return [lo, lo + size]
}

function alignedCoordinate(value: number, origin: number, unit: number): number {
    const coordinate = (value - origin) / unit
    const rounded = Math.round(coordinate)
    if (!Number.isSafeInteger(rounded) || Math.abs(coordinate - rounded) > 1e-6) {
        throw new Error('Display cell does not align to the schema lattice')
    }
    return rounded
}

/** Dynamic spatial index for original cells and exact area summaries at display resolution. */
export default class DisplayIndex {
    readonly bounds: Bounds
    /** Nodes visited by the most recent display query, useful for guarding query cost. */
    queryVisits = 0

    private readonly schema: Schema
    private readonly cells = new Map<number, DisplayCell>()
    private readonly levels = new Map<number, LevelStore>()
    private readonly chunks = new Map<string, CachedChunk>()
    private readonly edgeIds = new Map<string, number>()
    private readonly edgeKeys = new Map<number, string>()
    private nextRevision = 1
    private originX: number
    private originY: number
    private unitX = 0
    private unitY = 0
    private rootX: [number, number] = [0, 1]
    private rootY: [number, number] = [0, 1]

    constructor(bounds: Bounds, schema: Schema) {
        if (!validBounds(bounds)) throw new Error('Invalid display index bounds')
        this.bounds = [...bounds]
        this.schema = schema
        this.originX = schema.alignment_origin?.[0] ?? bounds[0]
        this.originY = schema.alignment_origin?.[1] ?? bounds[1]
        if (!Number.isFinite(this.originX) || !Number.isFinite(this.originY)) {
            throw new Error('Invalid display alignment origin')
        }
        if (schema.grid_info?.length) {
            this.unitX = Math.min(...schema.grid_info.map(info => info[0]))
            this.unitY = Math.min(...schema.grid_info.map(info => info[1]))
        } else if (schema.level_info?.length) {
            this.unitX = Math.min(...schema.level_info.map(info => (bounds[2] - bounds[0]) / info.width))
            this.unitY = Math.min(...schema.level_info.map(info => (bounds[3] - bounds[1]) / info.height))
        }
        this.initializeLattice()
    }

    upsert(input: DisplayCell): void {
        if (!validBounds(input.bounds) || !Number.isSafeInteger(input.id) || input.id < 0 ||
            !Number.isSafeInteger(input.level) || input.level < 0 ||
            !Number.isFinite(input.elevation) || !Number.isFinite(input.landClass)) {
            throw new Error('Invalid display cell')
        }
        const cell: DisplayCell = { ...input, bounds: [...input.bounds] }
        const previous = this.cells.get(cell.id)

        const store = this.getLevel(cell)
        const x0 = alignedCoordinate(cell.bounds[0], this.originX, this.unitX)
        const x1 = alignedCoordinate(cell.bounds[2], this.originX, this.unitX)
        const y0 = alignedCoordinate(cell.bounds[1], this.originY, this.unitY)
        const y1 = alignedCoordinate(cell.bounds[3], this.originY, this.unitY)
        if (x0 < this.rootX[0] || x1 > this.rootX[1] || y0 < this.rootY[0] || y1 > this.rootY[1]) throw new Error('Display cell lies outside index bounds')
        if (x1 - x0 !== store.widthUnits || y1 - y0 !== store.heightUnits || x0 % store.widthUnits !== 0 || y0 % store.heightUnits !== 0) throw new Error('Display cell does not match its schema level')
        if (previous) this.remove(cell.id)
        this.updateX(store.root, cell, x0, x1, y0, y1, 1)
        const tx = Math.floor(x0 / (store.widthUnits * CHUNK_SIZE))
        const ty = Math.floor(y0 / (store.heightUnits * CHUNK_SIZE))
        const key = tileKey(tx, ty)
        let tile = store.tiles.get(key)
        if (!tile) {
            tile = { x: tx, y: ty, ids: new Set() }
            store.tiles.set(key, tile)
        }
        tile.ids.add(cell.id)
        this.cells.set(cell.id, cell)
        this.invalidate(cell)
    }

    remove(id: number): void {
        const cell = this.cells.get(id)
        if (!cell) return
        const store = this.levels.get(cell.level)!
        const x0 = alignedCoordinate(cell.bounds[0], this.originX, this.unitX)
        const x1 = alignedCoordinate(cell.bounds[2], this.originX, this.unitX)
        const y0 = alignedCoordinate(cell.bounds[1], this.originY, this.unitY)
        const y1 = alignedCoordinate(cell.bounds[3], this.originY, this.unitY)
        this.updateX(store.root, cell, x0, x1, y0, y1, -1)
        const tx = Math.floor(x0 / (store.widthUnits * CHUNK_SIZE))
        const ty = Math.floor(y0 / (store.heightUnits * CHUNK_SIZE))
        const key = tileKey(tx, ty)
        const tile = store.tiles.get(key)!
        tile.ids.delete(id)
        if (!tile.ids.size) store.tiles.delete(key)
        this.cells.delete(id)
        this.invalidate(cell)
    }

    getCell(id: number): DisplayCell | undefined {
        return this.cells.get(id)
    }

    /** Exact original-cell coverage for a display sample or selection overlay. */
    summarize(bounds: Bounds, showDeleted = true): DisplayField | null {
        if (!validBounds(bounds)) throw new Error('Invalid summary bounds')
        return this.rangeSummary(bounds, [...this.levels.keys()], showDeleted).toField(bounds)
    }

    query(bounds: Bounds, metersPerPixel: number, showDeleted = true): GridDisplayView {
        if (!validBounds(bounds) || !Number.isFinite(metersPerPixel) || metersPerPixel <= 0) {
            throw new Error('Invalid display query')
        }
        this.queryVisits = 0
        const chunks: DisplayChunk[] = []
        const visible: Bounds = [
            Math.max(bounds[0], this.bounds[0]), Math.max(bounds[1], this.bounds[1]),
            Math.min(bounds[2], this.bounds[2]), Math.min(bounds[3], this.bounds[3]),
        ]
        if (!validBounds(visible)) return { chunks, cellCount: this.cells.size }

        const fineLevels: number[] = []
        for (const store of [...this.levels.values()].sort((a, b) => a.level - b.level)) {
            if (!store.tiles.size) continue
            if (Math.min(store.width, store.height) / metersPerPixel < CELL_PIXEL_THRESHOLD) {
                fineLevels.push(store.level)
            } else {
                this.visitTiles(store, visible, tile => {
                    const key = `cell:${store.level}:${tile.x}:${tile.y}:${showDeleted ? 1 : 0}`
                    const chunk = this.cached(key, this.cellChunk(store, tile, showDeleted), store.level)
                    if (chunk.cells.length) chunks.push(chunk)
                })
            }
        }

        if (fineLevels.length) {
            const stepX = sampleStep(this.unitX, metersPerPixel)
            const stepY = sampleStep(this.unitY, metersPerPixel)
            if (!(stepX > 0) || !(stepY > 0)) throw new Error('Display resolution is out of range')
            const firstX = Math.floor((visible[0] - this.originX) / (stepX * CHUNK_SIZE))
            const lastX = Math.floor((visible[2] - this.originX) / (stepX * CHUNK_SIZE))
            const firstY = Math.floor((visible[1] - this.originY) / (stepY * CHUNK_SIZE))
            const lastY = Math.floor((visible[3] - this.originY) / (stepY * CHUNK_SIZE))
            // Mode belongs to the fixed schema, not to the currently populated
            // stores. A local edit may create or empty a level anywhere.
            const schemaSizes = this.schema.grid_info?.length ? this.schema.grid_info
                : this.schema.level_info!.map(info => [
                    (this.bounds[2] - this.bounds[0]) / info.width,
                    (this.bounds[3] - this.bounds[1]) / info.height,
                ])
            const levelSignature = schemaSizes.flatMap(([width, height], level) =>
                Math.min(width, height) / metersPerPixel < CELL_PIXEL_THRESHOLD ? [level] : []).join(',')
            for (let cy = firstY; cy <= lastY; cy++) {
                for (let cx = firstX; cx <= lastX; cx++) {
                    const key = `field:${stepX}:${stepY}:${levelSignature}:${cx}:${cy}:${showDeleted ? 1 : 0}`
                    const chunkBounds: Bounds = [
                        this.originX + cx * CHUNK_SIZE * stepX,
                        this.originY + cy * CHUNK_SIZE * stepY,
                        this.originX + (cx + 1) * CHUNK_SIZE * stepX,
                        this.originY + (cy + 1) * CHUNK_SIZE * stepY,
                    ]
                    const chunk = this.cached(key, () => this.fieldChunk(key, chunkBounds, cx, cy, stepX, stepY, fineLevels, showDeleted), undefined, fineLevels, chunkBounds)
                    if (chunk.fields.length) chunks.push(chunk)
                }
            }
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

    getChunkRevision(key: string): number {
        return this.chunks.get(key)?.revision ?? 0
    }

    private initializeLattice(): void {
        if (!(this.unitX > 0) || !(this.unitY > 0) ||
            !Number.isFinite(this.unitX) || !Number.isFinite(this.unitY)) {
            throw new Error('Invalid display schema cell sizes')
        }
        this.rootX = axisRange(this.bounds, 0, this.originX, this.unitX)
        this.rootY = axisRange(this.bounds, 1, this.originY, this.unitY)
    }

    private getLevel(cell: DisplayCell): LevelStore {
        let store = this.levels.get(cell.level)
        if (store) return store
        const gridSize = this.schema.grid_info?.[cell.level]
        const levelCounts = this.schema.level_info?.[cell.level]
        const width = gridSize?.[0] ?? (levelCounts
            ? (this.bounds[2] - this.bounds[0]) / levelCounts.width
            : cell.bounds[2] - cell.bounds[0])
        const height = gridSize?.[1] ?? (levelCounts
            ? (this.bounds[3] - this.bounds[1]) / levelCounts.height
            : cell.bounds[3] - cell.bounds[1])
        if (!(width > 0) || !(height > 0)) throw new Error('Invalid display level geometry')
        const widthUnits = Math.round(width / this.unitX)
        const heightUnits = Math.round(height / this.unitY)
        if (widthUnits < 1 || heightUnits < 1 ||
            Math.abs(width / this.unitX - widthUnits) > 1e-6 ||
            Math.abs(height / this.unitY - heightUnits) > 1e-6) {
            throw new Error('Display level does not align to the finest schema lattice')
        }
        store = {
            level: cell.level, width, height, widthUnits, heightUnits,
            root: { lo: this.rootX[0], hi: this.rootX[1] },
            tiles: new Map(),
        }
        this.levels.set(cell.level, store)
        return store
    }

    private updateX(node: XNode, cell: DisplayCell, x0: number, x1: number,
        y0: number, y1: number, sign: 1 | -1): void {
        const overlap = Math.min(node.hi, x1) - Math.max(node.lo, x0)
        if (overlap <= 0) return
        node.total ??= makeY(this.rootY[0], this.rootY[1], cell)
        this.updateY(node.total, cell, y0, y1, overlap * this.unitX, sign)
        if (x0 <= node.lo && node.hi <= x1) {
            if (node.hi - node.lo === 1) {
                node.direct = node.total
                return
            }
            node.direct ??= makeY(this.rootY[0], this.rootY[1], cell)
            this.updateY(node.direct, cell, y0, y1, (node.hi - node.lo) * this.unitX, sign)
            return
        }
        const mid = (node.lo + node.hi) / 2
        if (x0 < mid) {
            node.left ??= { lo: node.lo, hi: mid }
            this.updateX(node.left, cell, x0, x1, y0, y1, sign)
            if (!node.left.total?.all.occupiedArea) node.left = undefined
        }
        if (x1 > mid) {
            node.right ??= { lo: mid, hi: node.hi }
            this.updateX(node.right, cell, x0, x1, y0, y1, sign)
            if (!node.right.total?.all.occupiedArea) node.right = undefined
        }
    }

    private updateY(node: YNode, cell: DisplayCell, y0: number, y1: number,
        xWidth: number, sign: 1 | -1): void {
        const overlap = Math.min(node.hi, y1) - Math.max(node.lo, y0)
        if (overlap <= 0) return
        const area = xWidth * overlap * this.unitY
        if (cell.deleted && node.live === node.all) node.live = node.all.clone()
        node.all.addCell(cell, area, sign)
        if (!cell.deleted && node.live !== node.all) node.live.addCell(cell, area, sign)
        if (y0 <= node.lo && node.hi <= y1) {
            if (!node.directAll) {
                node.directAll = new AreaSummary(cellSide(cell), cell.level)
                node.directLive = node.directAll
            }
            if (cell.deleted && node.directLive === node.directAll) {
                node.directLive = node.directAll.clone()
            }
            node.directAll.addCell(cell, area, sign)
            if (!cell.deleted && node.directLive !== node.directAll) {
                node.directLive!.addCell(cell, area, sign)
            }
            if (node.directAll.occupiedArea === node.directLive!.occupiedArea) {
                node.directLive = node.directAll
            }
            if (node.all.occupiedArea === node.live.occupiedArea) node.live = node.all
            return
        }
        const mid = (node.lo + node.hi) / 2
        if (y0 < mid) {
            node.left ??= makeY(node.lo, mid, cell)
            this.updateY(node.left, cell, y0, y1, xWidth, sign)
            if (!node.left.all.occupiedArea) node.left = undefined
        }
        if (y1 > mid) {
            node.right ??= makeY(mid, node.hi, cell)
            this.updateY(node.right, cell, y0, y1, xWidth, sign)
            if (!node.right.all.occupiedArea) node.right = undefined
        }
        if (node.all.occupiedArea === node.live.occupiedArea) node.live = node.all
    }

    private queryX(node: XNode | undefined, x0: number, x1: number,
        y0: number, y1: number, showDeleted: boolean, out: AreaSummary): void {
        if (!node || x1 <= node.lo || x0 >= node.hi ||
            !node.total || summary(node.total, showDeleted, false).occupiedArea <= 0) return
        this.queryVisits++
        if (x0 <= node.lo && node.hi <= x1) {
            this.queryY(node.total, y0, y1, showDeleted, out)
            return
        }
        const overlap = Math.min(x1, node.hi) - Math.max(x0, node.lo)
        if (node.direct && overlap > 0) {
            const local = new AreaSummary()
            this.queryY(node.direct, y0, y1, showDeleted, local)
            out.addSummary(local, overlap / (node.hi - node.lo))
        }
        this.queryX(node.left, x0, x1, y0, y1, showDeleted, out)
        this.queryX(node.right, x0, x1, y0, y1, showDeleted, out)
    }

    private queryY(node: YNode | undefined, y0: number, y1: number,
        showDeleted: boolean, out: AreaSummary): void {
        if (!node || y1 <= node.lo || y0 >= node.hi ||
            summary(node, showDeleted, false).occupiedArea <= 0) return
        this.queryVisits++
        if (y0 <= node.lo && node.hi <= y1) {
            out.addSummary(summary(node, showDeleted, false))
            return
        }
        const overlap = Math.min(y1, node.hi) - Math.max(y0, node.lo)
        if (overlap > 0) out.addSummary(summary(node, showDeleted, true), overlap / (node.hi - node.lo))
        this.queryY(node.left, y0, y1, showDeleted, out)
        this.queryY(node.right, y0, y1, showDeleted, out)
    }

    private rangeSummary(bounds: Bounds, levels: number[], showDeleted: boolean): AreaSummary {
        const out = new AreaSummary()
        const x0 = (bounds[0] - this.originX) / this.unitX
        const x1 = (bounds[2] - this.originX) / this.unitX
        const y0 = (bounds[1] - this.originY) / this.unitY
        const y1 = (bounds[3] - this.originY) / this.unitY
        for (const level of levels) {
            this.queryX(this.levels.get(level)?.root, x0, x1, y0, y1, showDeleted, out)
        }
        return out
    }

    private fieldChunk(key: string, bounds: Bounds, cx: number, cy: number,
        stepX: number, stepY: number, levels: number[], showDeleted: boolean): DisplayChunk {
        const fields: DisplayChunk['fields'] = []
        if (this.rangeSummary(bounds, levels, showDeleted).occupiedArea > 0) {
            for (let iy = 0; iy < CHUNK_SIZE; iy++) {
                for (let ix = 0; ix < CHUNK_SIZE; ix++) {
                    const sample: Bounds = [
                        this.originX + (cx * CHUNK_SIZE + ix) * stepX,
                        this.originY + (cy * CHUNK_SIZE + iy) * stepY,
                        this.originX + (cx * CHUNK_SIZE + ix + 1) * stepX,
                        this.originY + (cy * CHUNK_SIZE + iy + 1) * stepY,
                    ]
                    const field = this.rangeSummary(sample, levels, showDeleted).toField(sample)
                    if (field) fields.push(field)
                }
            }
        }
        return { key, bounds, cells: [], fields }
    }

    private cellChunk(store: LevelStore, tile: CellTile, showDeleted: boolean): () => DisplayChunk {
        return () => {
            const bounds: Bounds = [
                this.originX + tile.x * CHUNK_SIZE * store.width,
                this.originY + tile.y * CHUNK_SIZE * store.height,
                this.originX + (tile.x + 1) * CHUNK_SIZE * store.width,
                this.originY + (tile.y + 1) * CHUNK_SIZE * store.height,
            ]
            return {
                key: `cell:${store.level}:${tile.x}:${tile.y}:1`, bounds,
                cells: [...tile.ids].sort((a, b) => a - b).map(id => this.cells.get(id)!)
                    .filter(cell => showDeleted || !cell.deleted),
                fields: [],
            }
        }
    }

    private cached(key: string, build: () => DisplayChunk, level?: number,
        fineLevels?: number[], bounds?: Bounds): DisplayChunk {
        let entry = this.chunks.get(key)
        if (entry) {
            this.chunks.delete(key)
            this.chunks.set(key, entry)
            return entry.chunk
        }
        const chunk = build()
        chunk.key = key
        entry = {
            chunk, bounds: bounds ?? chunk.bounds, level, fineLevels,
            revision: this.nextRevision++,
        }
        this.chunks.set(key, entry)
        return chunk
    }

    private trimCache(visibleChunks: DisplayChunk[]): void {
        const visibleKeys = new Set(visibleChunks.map(chunk => chunk.key))
        for (const [key, entry] of this.chunks) {
            if (!entry.chunk.cells.length && !entry.chunk.fields.length) this.chunks.delete(key)
        }
        const budget = Math.max(MAX_CACHED_CHUNKS, visibleKeys.size)
        for (const key of this.chunks.keys()) {
            if (this.chunks.size <= budget) break
            if (!visibleKeys.has(key)) this.chunks.delete(key)
        }
    }

    private invalidate(cell: DisplayCell): void {
        for (const [key, entry] of this.chunks) {
            if ((entry.level === cell.level || entry.fineLevels !== undefined) &&
                intersects(entry.bounds, cell.bounds)) this.chunks.delete(key)
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
