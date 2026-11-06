import proj4 from 'proj4'
import type { ProjectionDefinition } from 'proj4/dist/lib/defs'
import type { Bounds, DisplayBlock, DisplayChunk, DisplayLayer, GridDisplayMeta } from './displayTypes'
import { DisplayGeometrySelector } from './displayGeometry'
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

/** No camera queue or retained sample geometry. The caller serializes tasks; only
 * viewport-bounded selection minima survive calls. Prepared arrays transfer out.
 */
export class DisplayGeometryEngine {
    private readonly projection
    private readonly selector
    private readonly points = new Map<number, Map<number, [number, number]>>()

    constructor(config: DisplayGeometryConfig) {
        proj4.defs('GRID_DISPLAY_SOURCE', JSON.parse(config.definition) as ProjectionDefinition)
        this.projection = proj4('GRID_DISPLAY_SOURCE', 'EPSG:4326')
        this.selector = new DisplayGeometrySelector(config.layers, config.origin,
            ([x, y]) => this.worldPoint(x, y))
    }

    run(task: DisplayGeometryTask) {
        if (task.type === 'reset') { this.points.clear(); return {} }
        if (task.type === 'publish') { this.selector.publish(task.selection, task.stopped); return {} }
        if (task.type === 'select') {
            // Selection and preparation share this view's exact grid vertices.
            // The next camera starts a new set; no visited-region history grows.
            this.points.clear()
            const blocks = this.selector.select(task.bounds, task.scale)
            return { blocks, selection: this.selector.selectionId }
        }
        if (task.type === 'prepare') return { prepared: this.prepare(task.chunks) }
        const chunks = task.blocks.map(({ buffer, block }) => decodeDisplayBlock(buffer, block, task.meta))
        return { chunks, prepared: this.prepare(chunks) }
    }

    prepare(chunks: DisplayChunk[]): PreparedDisplayChunk[] {
        return chunks.map(chunk => {
            const [bx0, by0, bx1, by1] = chunk.bounds
            const origin = this.worldPoint((bx0 + bx1) / 2, (by0 + by1) / 2)
            const corners = [[bx0, by0], [bx1, by0], [bx1, by1], [bx0, by1]] as [number, number][]
            const world = corners.map(([x, y]) => this.worldPoint(x, y))
            const worldBounds: Bounds = [Math.min(...world.map(p => p[0])), Math.min(...world.map(p => p[1])), Math.max(...world.map(p => p[0])), Math.max(...world.map(p => p[1]))]
            const data = new Float32Array((chunk.cells.length + chunk.fields.length) * 16)
            const samples = [...chunk.cells, ...chunk.fields]
            samples.forEach((sample, index) => {
                const [x0, y0, x1, y1] = sample.bounds
                const offset = index * 16
                for (const [corner, [x, y]] of [[x0, y1], [x1, y1], [x0, y0], [x1, y0]].entries()) {
                    const world = this.worldPoint(x, y)
                    data[offset + corner * 2] = world[0] - origin[0]
                    data[offset + corner * 2 + 1] = world[1] - origin[1]
                }
                const field = 'occupiedFraction' in sample
                data.set([sample.level, sample.elevation, sample.landClass, field ? sample.minCellSize : Math.min(x1 - x0, y1 - y0),
                    field ? x1 - x0 : 0, field ? y1 - y0 : sample.deleted ? 1 : 0, 0, field ? sample.occupiedFraction : 1], offset + 8)
            })
            return { data, origin, corners: corners.map(p => this.projection.forward(p)), worldBounds }
        })
    }

    private worldPoint(x: number, y: number): [number, number] {
        let column = this.points.get(x)
        if (!column) { column = new Map(); this.points.set(x, column) }
        let value = column.get(y)
        if (!value) {
            value = MercatorCoordinate.fromLonLat(this.projection.forward([x, y] as [number, number]))
            if (!value.every(Number.isFinite)) throw new Error('Nonfinite display geometry')
            column.set(y, value)
        }
        return value
    }
}
