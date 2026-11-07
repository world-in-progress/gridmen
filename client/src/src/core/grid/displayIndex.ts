import type {
    Bounds, DisplayBlock, DisplayCell, DisplayField, DisplayLayer, GridDisplayMeta, GridDisplayView, GridInspection,
} from './displayTypes'
import { AreaSummary, cellSide, containsPoint, intersectionArea, intersects, validBounds } from './displayMath'
import { axisIndex, blockKey, displayLayer, displayLayers, nodeBounds } from './displayHierarchy'
import { DisplayViewCache } from './displayBlockCache'

const CHUNK_SIZE = 64
type Schema = Pick<GridDisplayMeta, 'grid_info' | 'alignment_origin'>
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
function tileKey(x: number, y: number): string { return `${x},${y}` }

/** The same native/dyadic hierarchy as the server. An edit changes one ancestor path. */
export default class DisplayIndex {
    readonly bounds: Bounds
    readonly displayLayers: DisplayLayer[]
    readonly origin: [number, number]
    private readonly cells = new Map<number, DisplayCell>()
    private readonly levels = new Map<number, LevelStore>()
    private readonly nodes: Map<string, SummaryNode>[]
    private readonly nativeLayers = new Map<number, number>()
    readonly cache = new DisplayViewCache()
    private selectionExceptions = new Set<number>()
    private selectionDefault = false
    private selectionEpoch = 0
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
        const sizes = schema.grid_info
        this.displayLayers = displayLayers(bounds, sizes, this.origin)
        this.nodes = this.displayLayers.map(() => new Map())
        this.unitX = sizes[sizes.length - 1][0]
        this.unitY = sizes[sizes.length - 1][1]
        this.displayLayers.forEach((layer, i) => {
            if (layer.nativeLevel !== null) {
                this.nativeLayers.set(layer.nativeLevel, i)
                this.levels.set(layer.nativeLevel, { level: layer.nativeLevel, width: layer.width, height: layer.height, tiles: new Map() })
            }
        })
    }

    /** Initial build visits each stored node once, bottom-up. */
    load(cells: Iterable<DisplayCell>): void {
        if (this.cells.size) throw new Error('Initial display load requires an empty index')
        for (const input of cells) {
            const cell = input
            if (this.cells.has(cell.id)) throw new Error('Duplicate display cell ID')
            const layer = this.nativeLayers.get(cell.level)!
            const [x, y] = this.locate(layer, (cell.bounds[0] + cell.bounds[2]) / 2, (cell.bounds[1] + cell.bounds[3]) / 2)
            const node = this.node(layer, x, y)
            if (node.original) throw new Error('Duplicate display cell geometry')
            node.original = cell
            node.all.addCell(cell, (cell.bounds[2] - cell.bounds[0]) * (cell.bounds[3] - cell.bounds[1]), 1)
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
        const cell = input
        const old = this.cells.get(cell.id)
        const selected = !!old && this.isSelected(cell.id)
        if (old) this.change(old, -1)
        this.markSelected(cell.id, selected)
        this.change(cell, 1)
    }

    remove(id: number): void {
        const cell = this.cells.get(id)
        if (cell) { this.change(cell, -1); this.selectionExceptions.delete(id) }
    }

    getCell(id: number): DisplayCell | undefined { return this.cells.get(id) }

    setSelected(id: number, selected: boolean): void {
        const cell = this.cells.get(id)
        if (!cell || this.isSelected(id) === selected) return
        this.markSelected(id, selected)
        const area = (cell.bounds[2] - cell.bounds[0]) * (cell.bounds[3] - cell.bounds[1]) * (selected ? 1 : -1)
        let i = this.nativeLayers.get(cell.level)!
        let [x, y] = this.locate(i, (cell.bounds[0] + cell.bounds[2]) / 2, (cell.bounds[1] + cell.bounds[3]) / 2)
        for (; i < this.nodes.length; i++) {
            const node = this.nodes[i].get(tileKey(x, y))!
            this.adjustSelected(node.all, area)
            if (!cell.deleted && node.live !== node.all) this.adjustSelected(node.live, area)
            if (i + 1 < this.nodes.length) [x, y] = this.parentCoordinates(node)
        }
    }

    /** A new epoch avoids touching every ancestor on bulk selection. */
    selectAll(selected: boolean): void {
        this.selectionDefault = selected
        this.selectionExceptions.clear()
        this.selectionEpoch++
    }

    /** Selection opacity is queried on the exact same display node, without leaf descent. */
    selectedFraction(bounds: Bounds, showDeleted = true): number {
        const summary = this.summaryFor(bounds, showDeleted)
        return summary && summary.occupiedArea > 0 ? Math.min(1, Math.max(0, this.effectiveSelectedArea(summary) / summary.occupiedArea)) : 0
    }

    summarize(bounds: Bounds, showDeleted = true): DisplayField | null {
        return this.summaryFor(bounds, showDeleted)?.toField(bounds) ?? null
    }

    private summaryFor(bounds: Bounds, showDeleted: boolean): AreaSummary | null {
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
                if (node) return showDeleted ? node.all : node.live
                for (let j = i + 1; j < this.displayLayers.length; j++) {
                    const [cx, cy] = this.locate(j, (bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2)
                    const cell = this.nodes[j].get(tileKey(cx, cy))?.original
                    if (cell && (showDeleted || !cell.deleted)) {
                        const summary = new AreaSummary()
                        summary.addCell(cell, intersectionArea(bounds, cell.bounds), 1, this.isSelected(cell.id))
                        summary.selectionEpoch = this.selectionEpoch
                        return summary
                    }
                }
                return null
            }
        }
        throw new Error('Selection summary must address a display node')
    }

    cacheKeys(blocks: DisplayBlock[], showDeleted = true): string[] {
        return blocks.map(block => `${blockKey(block)}:${showDeleted ? 1 : 0}`)
    }

    queryBlocks(blocks: DisplayBlock[], showDeleted = true): GridDisplayView {
        const keys = this.cacheKeys(blocks, showDeleted)
        this.cache.begin(keys)
        for (let position = 0; position < blocks.length; position++) {
            const block = blocks[position]
            const key = keys[position]
            if (this.cache.getBlock(key)) continue
            const { blockLayer: i, x, y, displayLayer } = block
            const layer = this.layer(i)
            this.ensureLayer(i)
            const bounds = nodeBounds(layer, x, y, this.origin)
            let enclosing: DisplayCell | undefined
            for (let j = i + 1; j < this.displayLayers.length; j++) {
                const [cx, cy] = this.locate(j, (bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2)
                const cell = this.nodes[j].get(tileKey(cx, cy))?.original
                if (cell) { enclosing = cell; break }
            }
            if (enclosing) {
                this.cache.setBlock(key, showDeleted || !enclosing.deleted
                    ? [{ key: `original:${enclosing.id}`, bounds: enclosing.bounds, cells: [enclosing], fields: [] }]
                    : [])
                continue
            }
            const cells: DisplayCell[] = [], fields: DisplayField[] = []
            const visit = (node: SummaryNode) => {
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
            this.cache.setBlock(key, cells.length || fields.length ? [{ key, bounds, cells, fields }] : [])
        }
        return this.cache.view(keys)
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
                neighbors.push({ side, cell: other })
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
        for (let i = first; i < this.nodes.length; i++) {
            const node = sign === 1 ? this.node(i, x, y) : this.nodes[i].get(tileKey(x, y))!
            if (i === first) node.original = sign === 1 ? cell : undefined
            if (child) {
                const found = node.children.indexOf(child)
                if (child.all.occupiedArea > 0 && found < 0) node.children.push(child)
                if (child.all.occupiedArea <= 0 && found >= 0) node.children.splice(found, 1)
            }
            if (cell.deleted && node.live === node.all) node.live = node.all.clone()
            this.refreshSummary(node)
            if (!node.hasDeleted) node.live = node.all
            this.cache.deleteNode(`${i}:${x}:${y}`)
            if (node.all.occupiedArea === 0) this.nodes[i].delete(tileKey(x, y))
            child = node
            if (i + 1 < this.nodes.length) [x, y] = this.parentCoordinates(node)
        }
        this.cache.deleteChunk(`original:${cell.id}`)
        this.storeCell(cell, sign === 1)
    }

    private isSelected(id: number): boolean {
        return this.selectionDefault !== this.selectionExceptions.has(id)
    }

    private markSelected(id: number, selected: boolean): void {
        if (selected !== this.selectionDefault) this.selectionExceptions.add(id)
        else this.selectionExceptions.delete(id)
    }

    private effectiveSelectedArea(summary: AreaSummary): number {
        return summary.selectionEpoch === this.selectionEpoch
            ? summary.selectedArea : (this.selectionDefault ? summary.occupiedArea : 0)
    }

    private adjustSelected(summary: AreaSummary, area: number): void {
        if (summary.selectionEpoch !== this.selectionEpoch) {
            summary.selectedArea = this.selectionDefault ? summary.occupiedArea : 0
            summary.selectionEpoch = this.selectionEpoch
        }
        summary.selectedArea += area
    }

    private refreshSummary(node: SummaryNode): void {
        for (const summary of node.live === node.all ? [node.all] : [node.all, node.live]) {
            const live = summary === node.live && summary !== node.all
            const original = node.original && (!live || !node.original.deleted) ? node.original : undefined
            summary.occupiedArea = original ? (original.bounds[2] - original.bounds[0]) * (original.bounds[3] - original.bounds[1]) : 0
            summary.selectedArea = original && this.isSelected(original.id) ? summary.occupiedArea : 0
            summary.selectionEpoch = this.selectionEpoch
            summary.minCellSize = node.original && (!live || !node.original.deleted) ? cellSide(node.original) : Infinity
            summary.finestLevel = node.original && (!live || !node.original.deleted) ? node.original.level : -Infinity
            for (const child of node.children) {
                const value = live ? child.live : child.all
                summary.occupiedArea += value.occupiedArea
                summary.selectedArea += this.effectiveSelectedArea(value)
                summary.minCellSize = Math.min(summary.minCellSize, value.minCellSize)
                summary.finestLevel = Math.max(summary.finestLevel, value.finestLevel)
            }
        }
        node.hasDeleted = !!node.original?.deleted || node.children.some(child => child.hasDeleted)
        node.jump = node.children.length === 1 ? node.children[0].jump ?? node.children[0] : undefined
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
                        visit(tile)
                }
            }
        } else {
            for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
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
}
