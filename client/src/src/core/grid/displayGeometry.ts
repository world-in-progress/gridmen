import type { Bounds, DisplayBlock, DisplayLayer } from './displayTypes'
import { axisBounds, displayLayer, nodeBounds, nodeRange, NODE_RADIUS, projectedCornerRadius, projectedCorners, selectDisplayBlocks, type ProjectPoint } from './displayHierarchy'

interface Minimum { acceptedRadius: number; rejectedRadius: number; rejectedBounds?: Bounds }
interface NodeMeasure { radius: number; size: number }
export type DisplayGeometryFootprint =
    | { key: string; bounds: Bounds }
    | { key: string; layer: DisplayLayer; range: [number, number, number, number]; origin: [number, number] }
interface SelectionFootprint { id: number; nodes: Set<string>; minima: Set<string>; bounds: Bounds[]; geometry: Map<string, DisplayGeometryFootprint> }

/** Enumerate exactly the source vertices of a selection's geometric work.
 * Coordinate equality, including native-reset roundoff, is never approximated.
 */
export function visitDisplayGeometry(footprint: DisplayGeometryFootprint, visit: (x: number, y: number) => void): void {
    if ('bounds' in footprint) {
        const [x0, y0, x1, y1] = footprint.bounds
        visit(x0, y0); visit(x1, y0); visit(x1, y1); visit(x0, y1)
        return
    }
    const { layer, range: [x0, y0, x1, y1], origin } = footprint
    const axis = (start: number, end: number, size: number, layout: DisplayLayer['xLayout'], offset: number) => {
        const result: number[] = []
        for (let i = start; i < end; i++) {
            const [lo, hi] = axisBounds(i, size, layout)
            for (const value of [offset + lo, offset + hi]) if (result[result.length - 1] !== value) result.push(value)
        }
        return result
    }
    const xs = axis(x0, x1, layer.width, layer.xLayout, origin[0])
    const ys = axis(y0, y1, layer.height, layer.yLayout, origin[1])
    for (const x of xs) for (const y of ys) visit(x, y)
}
// Fixed lattice ranges let a partition change reuse the same complete proofs.
// This is a spatial subdivision of a viewport footprint, not a cache capacity.
const MINIMUM_SPAN = 32

/** One source/lattice/projection instance. Pan translates Mercator; zoom uniformly
 * scales it at zero pitch/bearing. Cache geometric lengths, never camera choices.
 * Every candidate node is measured, including native-reset/clipped strips. A
 * partial minimum proves rejection only; a finer zoom must finish that scan.
 */
export class DisplayGeometrySelector {
    private nodes = new Map<string, NodeMeasure>()
    private minima = new Map<string, Minimum>()
    private sequence = 0
    private current?: SelectionFootprint
    private published?: SelectionFootprint
    private settled: SelectionFootprint[] = []

    constructor(private readonly layers: DisplayLayer[], private readonly origin: [number, number], private readonly project: ProjectPoint,
        private readonly projectIsCached = false) {}

    select(viewport: Bounds, pixelsPerUnit: number, requiredRadius = NODE_RADIUS) {
        if (!(pixelsPerUnit > 0) || !Number.isFinite(pixelsPerUnit)) throw new Error('Invalid display projection scale')
        if (!(requiredRadius > 0) || !Number.isFinite(requiredRadius)) throw new Error('Invalid display node radius')
        const usedNodes = new Set<string>(), usedMinima = new Set<string>()
        const geometry = new Map<string, DisplayGeometryFootprint>()
        const quad = (bounds: Bounds) => {
            const key = `q:${bounds.join(',')}`
            geometry.set(key, { key, bounds })
        }
        // Vertex sharing is bounded by this selection, not all visited regions.
        const vertices = new Map<number, Map<number, [number, number]>>()
        const project: ProjectPoint = this.projectIsCached ? this.project : ([x, y]) => {
            let column = vertices.get(x)
            if (!column) { column = new Map(); vertices.set(x, column) }
            let point = column.get(y)
            if (!point) {
                point = this.project([x, y])
                if (!point.every(Number.isFinite)) throw new Error('Nonfinite display projection')
                column.set(y, point)
            }
            return point
        }
        const measure = (bounds: Bounds) => {
            const key = bounds.join(',')
            usedNodes.add(key)
            quad(bounds)
            let value = this.nodes.get(key)
            if (!value) {
                const corners = projectedCorners(bounds, project)
                value = { radius: projectedCornerRadius(corners), size: Math.max(...corners.map((p, i) => Math.hypot(p[0] - corners[(i + 1) % 4][0], p[1] - corners[(i + 1) % 4][1]))) }
                this.nodes.set(key, value)
            }
            return value
        }
        const fits = (radius: number) => radius * pixelsPerUnit + 1e-9 >= requiredRadius
        const rangeFits = (index: number, x0: number, y0: number, x1: number, y1: number) => {
            const key = `${index}:${x0},${y0},${x1},${y1}`
            usedMinima.add(key)
            const old = this.minima.get(key)
            const layer = displayLayer(this.layers, index)
            const accepted = () => { geometry.set(`r:${key}`, { key: `r:${key}`, layer, range: [x0, y0, x1, y1], origin: this.origin }); return true }
            if (old && fits(old.acceptedRadius)) return accepted()
            if (old && !fits(old.rejectedRadius)) { quad(old.rejectedBounds!); return false }
            let radius = Infinity
            const xs: number[] = []
            for (let x = x0; x < x1; x++) {
                const [lo, hi] = axisBounds(x, layer.width, layer.xLayout)
                xs.push(this.origin[0] + lo, this.origin[0] + hi)
            }
            const scratch = { nx: [0, 0, 0, 0], ny: [0, 0, 0, 0], offsets: [0, 0, 0, 0] }
            let previousY: number | undefined, previousRow: [number, number][] | undefined
            for (let y = y0; y < y1; y++) {
                const [lo, hi] = axisBounds(y, layer.height, layer.yLayout)
                const bottomY = this.origin[1] + lo, topY = this.origin[1] + hi
                const bottom: [number, number][] = previousY === bottomY ? previousRow! : []
                const top: [number, number][] = []
                for (let i = 0; i < xs.length; i += 2) {
                    bottom[i] ??= project([xs[i], bottomY])
                    bottom[i + 1] ??= project([xs[i + 1], bottomY])
                    top[i] ??= project([xs[i], topY])
                    top[i + 1] = project([xs[i + 1], topY])
                    radius = Math.min(radius, projectedCornerRadius([bottom[i], bottom[i + 1], top[i + 1], top[i]], (requiredRadius - 1e-9) / pixelsPerUnit, scratch))
                    if (!fits(radius)) {
                        const rejectedBounds: Bounds = old && old.rejectedRadius <= radius ? old.rejectedBounds! : [xs[i], bottomY, xs[i + 1], topY]
                        this.minima.set(key, { acceptedRadius: old?.acceptedRadius ?? 0, rejectedRadius: Math.min(old?.rejectedRadius ?? Infinity, radius), rejectedBounds })
                        quad(rejectedBounds)
                        return false
                    }
                    // Share only equal source coordinates, including roundoff
                    // at native resets and nonbinary tail seams. A rejection
                    // must not project any of the following nodes eagerly.
                    if (xs[i + 1] === xs[i + 2]) { bottom[i + 2] = bottom[i + 1]; top[i + 2] = top[i + 1] }
                }
                previousY = topY; previousRow = top
            }
            this.minima.set(key, { acceptedRadius: Math.max(old?.acceptedRadius ?? 0, radius), rejectedRadius: old?.rejectedRadius ?? Infinity, rejectedBounds: old?.rejectedBounds })
            return accepted()
        }
        let result: DisplayBlock[]
        try { result = selectDisplayBlocks(this.layers, this.origin, viewport, project, {
            fits: bounds => fits(measure(bounds).radius),
            size: bounds => measure(bounds).size * pixelsPerUnit,
            layerFits: (index, bounds) => {
                const layer = displayLayer(this.layers, index)
                const [x0, y0, x1, y1] = nodeRange(layer, bounds, this.origin)
                for (let y = y0; y < y1;) {
                    const endY = Math.min(y1, (Math.floor(y / MINIMUM_SPAN) + 1) * MINIMUM_SPAN)
                    for (let x = x0; x < x1;) {
                        const endX = Math.min(x1, (Math.floor(x / MINIMUM_SPAN) + 1) * MINIMUM_SPAN)
                        if (!rangeFits(index, x, y, endX, endY)) return false
                        x = endX
                    }
                    y = endY
                }
                return true
            },
        }) } catch (error) { this.prune(); throw error }
        this.current = { id: ++this.sequence, nodes: usedNodes, minima: usedMinima, geometry,
            bounds: result.map(block => nodeBounds(displayLayer(this.layers, block.blockLayer), block.x, block.y, this.origin)) }
        this.prune()
        return result
    }

    get selectionId(): number { return this.current!.id }

    /** Work identities include the layer and exact range, so a coarse view
     * cannot own fine vertices merely because they share a spatial rectangle.
     */
    get geometryFootprints(): DisplayGeometryFootprint[] {
        return [...new Set([this.current, this.published, ...this.settled])].flatMap(view => view ? [...view.geometry.values()] : [])
    }

    /** Intermediate zoom cameras must not evict the two stopped, complete views
     * that a zoom round trip revisits. One candidate and the published view may
     * additionally be live. These are finite viewport footprints, not history.
     */
    publish(id: number, stopped: boolean): void {
        const view = [this.current, this.published, ...this.settled].find(view => view?.id === id)
        if (!view) throw new Error('Expired display geometry selection')
        this.published = view
        if (stopped) {
            const same = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every(key => b.has(key))
            this.settled = [view, ...this.settled.filter(old => !same(old.nodes, view.nodes) || !same(old.minima, view.minima)
                || old.geometry.size !== view.geometry.size || [...old.geometry.keys()].some(key => !view.geometry.has(key)))].slice(0, 2)
        }
        this.prune()
    }

    private prune(): void {
        const live = [this.current, this.published, ...this.settled]
        for (const key of this.nodes.keys()) if (!live.some(view => view?.nodes.has(key))) this.nodes.delete(key)
        for (const key of this.minima.keys()) if (!live.some(view => view?.minima.has(key))) this.minima.delete(key)
    }
}
