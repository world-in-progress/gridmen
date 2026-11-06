import proj4 from 'proj4'
import type { ProjectionDefinition } from 'proj4/dist/lib/defs'
import type { Bounds, DisplayBlock, DisplayChunk, DisplayLayer, GridDisplayMeta } from './displayTypes'
import { DisplayGeometrySelector, visitDisplayGeometry } from './displayGeometry'
import { decodeDisplayBlock } from './displayWire'
import { MercatorCoordinate } from '../math/mercatorCoordinate'

export interface DisplayGeometryConfig {
    layers: DisplayLayer[]
    origin: [number, number]
    /** Serialized proj4 definition; each worker belongs to exactly one source. */
    definition: string
}
export interface PreparedDisplayChunk {
    data: Float32Array
    origin: [number, number]
    /** Public longitude/latitude for culling in projections other than Mercator. */
    corners: [number, number][]
    worldBounds: Bounds
}
export type DisplayGeometryTask =
    | { type: 'reset' }
    | { type: 'select'; bounds: Bounds; scale: number }
    | { type: 'publish'; selection: number; stopped: boolean }
    | { type: 'prepare'; chunks: DisplayChunk[] }
    | { type: 'decode'; blocks: { block: DisplayBlock; buffer: ArrayBuffer }[]; meta: GridDisplayMeta }

interface DisplayVertex { x: number; y: number; world?: [number, number]; references: number }
interface VertexColumn { points: Map<number, DisplayVertex> }

/** The caller serializes tasks. Exact vertices and selection proofs follow the
 * candidate, published and two stopped viewport footprints. Arrays transfer out.
 */
export class DisplayGeometryEngine {
    private readonly projection
    private readonly selector
    private readonly points = new Map<number, VertexColumn>()
    private readonly geometryGroups = new Map<string, DisplayVertex[]>()
    private transient: DisplayVertex[] = []

    constructor(config: DisplayGeometryConfig) {
        proj4.defs('GRID_DISPLAY_SOURCE', JSON.parse(config.definition) as ProjectionDefinition)
        this.projection = proj4('GRID_DISPLAY_SOURCE', 'EPSG:4326')
        this.selector = new DisplayGeometrySelector(config.layers, config.origin,
            ([x, y]) => this.worldPoint(x, y), true)
    }

    run(task: DisplayGeometryTask) {
        if (task.type === 'reset') {
            this.points.clear(); this.geometryGroups.clear(); this.transient = []
            return {}
        }
        if (task.type === 'publish') {
            this.selector.publish(task.selection, task.stopped)
            this.syncVertexReferences()
            return {}
        }
        if (task.type === 'select') {
            try {
                const blocks = this.selector.select(task.bounds, task.scale)
                return { blocks, selection: this.selector.selectionId }
            } finally { this.syncVertexReferences() }
        }
        if (task.type === 'prepare') return { prepared: this.prepare(task.chunks) }
        const chunks = task.blocks.map(({ buffer, block }) => decodeDisplayBlock(buffer, block, task.meta))
        return { chunks, prepared: this.prepare(chunks) }
    }

    prepare(chunks: DisplayChunk[]): PreparedDisplayChunk[] {
        try { return chunks.map(chunk => this.prepareChunk(chunk)) }
        finally {
            // Prepared arrays transfer out. Vertices outside the selection's
            // actual geometric work are temporary, including crossing originals.
            this.pruneTransient()
        }
    }

    private prepareChunk(chunk: DisplayChunk): PreparedDisplayChunk {
        const [bx0, by0, bx1, by1] = chunk.bounds
        const origin = this.worldPoint((bx0 + bx1) / 2, (by0 + by1) / 2)
        const corners = [[bx0, by0], [bx1, by0], [bx1, by1], [bx0, by1]] as [number, number][]
        const world = corners.map(([x, y]) => this.worldPoint(x, y))
        const worldBounds: Bounds = [Math.min(...world.map(p => p[0])), Math.min(...world.map(p => p[1])), Math.max(...world.map(p => p[0])), Math.max(...world.map(p => p[1]))]
        const data = new Float32Array((chunk.cells.length + chunk.fields.length) * 16)
        for (let index = 0; index < chunk.cells.length + chunk.fields.length; index++) {
            const field = index >= chunk.cells.length
            const sample = field ? chunk.fields[index - chunk.cells.length] : chunk.cells[index]
            const [x0, y0, x1, y1] = sample.bounds
            const offset = index * 16
            const tl = this.worldPoint(x0, y1), tr = this.worldPoint(x1, y1)
            const bl = this.worldPoint(x0, y0), br = this.worldPoint(x1, y0)
            data[offset] = tl[0] - origin[0]; data[offset + 1] = tl[1] - origin[1]
            data[offset + 2] = tr[0] - origin[0]; data[offset + 3] = tr[1] - origin[1]
            data[offset + 4] = bl[0] - origin[0]; data[offset + 5] = bl[1] - origin[1]
            data[offset + 6] = br[0] - origin[0]; data[offset + 7] = br[1] - origin[1]
            data[offset + 8] = sample.level; data[offset + 9] = sample.elevation; data[offset + 10] = sample.landClass
            if ('occupiedFraction' in sample) {
                data[offset + 11] = sample.minCellSize
                data[offset + 12] = x1 - x0; data[offset + 13] = y1 - y0
                data[offset + 15] = sample.occupiedFraction
            } else {
                data[offset + 11] = Math.min(x1 - x0, y1 - y0)
                data[offset + 13] = sample.deleted ? 1 : 0
                data[offset + 15] = 1
            }
        }
        return { data, origin, corners: corners.map(p => this.projection.forward(p)), worldBounds }
    }

    private worldPoint(x: number, y: number): [number, number] {
        const vertex = this.vertex(x, y)
        if (!vertex.world) {
            const world = MercatorCoordinate.fromLonLat(this.projection.forward([x, y] as [number, number]))
            if (!world.every(Number.isFinite)) throw new Error('Nonfinite display geometry')
            vertex.world = world
        }
        return vertex.world
    }

    private vertex(x: number, y: number): DisplayVertex {
        let column = this.points.get(x)
        if (!column) { column = { points: new Map() }; this.points.set(x, column) }
        let vertex = column.points.get(y)
        if (!vertex) {
            vertex = { x, y, references: 0 }
            column.points.set(y, vertex)
            this.transient.push(vertex)
        }
        return vertex
    }

    private syncVertexReferences(): void {
        const live = new Map(this.selector.geometryFootprints.map(footprint => [footprint.key, footprint]))
        // Acquire before releasing so intersecting resolution footprints can
        // share exact values across a canonical partition change.
        for (const [key, footprint] of live) if (!this.geometryGroups.has(key)) {
            const vertices: DisplayVertex[] = []
            visitDisplayGeometry(footprint, (x, y) => {
                const vertex = this.vertex(x, y)
                vertex.references++
                vertices.push(vertex)
            })
            this.geometryGroups.set(key, vertices)
        }
        for (const [key, vertices] of this.geometryGroups) if (!live.has(key)) {
            for (const vertex of vertices) {
                if (--vertex.references === 0) this.removeVertex(vertex)
            }
            this.geometryGroups.delete(key)
        }
        this.pruneTransient()
    }

    private pruneTransient(): void {
        for (const vertex of this.transient) if (!vertex.references) this.removeVertex(vertex)
        this.transient = []
    }

    private removeVertex(vertex: DisplayVertex): void {
        const column = this.points.get(vertex.x)
        if (column?.points.get(vertex.y) !== vertex) return
        column.points.delete(vertex.y)
        if (!column.points.size) this.points.delete(vertex.x)
    }
}
