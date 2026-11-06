import type { Bounds, DisplayLayer } from './displayTypes'
import { displayLayer, nodeBounds, nodeRange, NODE_RADIUS, projectedCorners, projectedRadius, selectDisplayBlocks, type ProjectPoint } from './displayHierarchy'

interface Minimum { acceptedRadius: number; rejectedRadius: number }
interface NodeMeasure { radius: number; size: number }
interface SelectionFootprint { id: number; nodes: Set<string>; minima: Set<string> }

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

    constructor(private readonly layers: DisplayLayer[], private readonly origin: [number, number], private readonly project: ProjectPoint) {}

    select(viewport: Bounds, pixelsPerUnit: number) {
        if (!(pixelsPerUnit > 0) || !Number.isFinite(pixelsPerUnit)) throw new Error('Invalid display projection scale')
        const usedNodes = new Set<string>(), usedMinima = new Set<string>()
        // Vertex sharing is bounded by this selection, not all visited regions.
        const vertices = new Map<number, Map<number, [number, number]>>()
        const project: ProjectPoint = ([x, y]) => {
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
            let value = this.nodes.get(key)
            if (!value) {
                const corners = projectedCorners(bounds, project)
                value = { radius: projectedRadius(bounds, project), size: Math.max(...corners.map((p, i) => Math.hypot(p[0] - corners[(i + 1) % 4][0], p[1] - corners[(i + 1) % 4][1]))) }
                this.nodes.set(key, value)
            }
            return value
        }
        const fits = (radius: number) => radius * pixelsPerUnit + 1e-9 >= NODE_RADIUS
        const result = selectDisplayBlocks(this.layers, this.origin, viewport, project, {
            fits: bounds => fits(measure(bounds).radius),
            size: bounds => measure(bounds).size * pixelsPerUnit,
            layerFits: (index, bounds) => {
                const key = `${index}:${bounds.join(',')}`
                usedMinima.add(key)
                const old = this.minima.get(key)
                if (old && fits(old.acceptedRadius)) return true
                if (old && !fits(old.rejectedRadius)) return false
                const layer = displayLayer(this.layers, index)
                const [x0, y0, x1, y1] = nodeRange(layer, bounds, this.origin)
                let radius = Infinity
                for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
                    radius = Math.min(radius, projectedRadius(nodeBounds(layer, x, y, this.origin), project, (NODE_RADIUS - 1e-9) / pixelsPerUnit))
                    if (!fits(radius)) {
                        this.minima.set(key, { acceptedRadius: old?.acceptedRadius ?? 0, rejectedRadius: Math.min(old?.rejectedRadius ?? Infinity, radius) })
                        return false
                    }
                }
                this.minima.set(key, { acceptedRadius: Math.max(old?.acceptedRadius ?? 0, radius), rejectedRadius: old?.rejectedRadius ?? Infinity })
                return true
            },
        })
        this.current = { id: ++this.sequence, nodes: usedNodes, minima: usedMinima }
        this.prune()
        return result
    }

    get selectionId(): number { return this.current!.id }

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
            this.settled = [view, ...this.settled.filter(old => !same(old.nodes, view.nodes) || !same(old.minima, view.minima))].slice(0, 2)
        }
        this.prune()
    }

    private prune(): void {
        const live = [this.current, this.published, ...this.settled]
        for (const key of this.nodes.keys()) if (!live.some(view => view?.nodes.has(key))) this.nodes.delete(key)
        for (const key of this.minima.keys()) if (!live.some(view => view?.minima.has(key))) this.minima.delete(key)
    }
}
