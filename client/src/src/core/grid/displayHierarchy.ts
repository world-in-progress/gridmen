import type { Bounds, DisplayBlock, DisplayLayer } from './displayTypes'
import { intersects } from './displayMath'

type Layout = [number, number] | null
export type ProjectPoint = (point: [number, number]) => [number, number]
export const NODE_RADIUS = 0.75
const BLOCK_PIXELS = 128

export function axisBounds(index: number, size: number, layout: Layout): [number, number] {
    if (!layout) return [index * size, (index + 1) * size]
    const [period, count] = layout
    const group = Math.floor(index / count), local = index - group * count
    return [group * period + local * size, group * period + Math.min((local + 1) * size, period)]
}

/** Snap arithmetic roundoff at lattice lines, without changing original point ownership. */
function latticeInteger(value: number): number {
    const nearest = Math.round(value)
    return Math.abs(value - nearest) <= 4 * Number.EPSILON * Math.max(1, Math.abs(value)) ? nearest : value
}

export function axisIndex(value: number, size: number, layout: Layout): number {
    if (!layout) return Math.floor(latticeInteger(value / size))
    const [period, count] = layout
    const group = Math.floor(latticeInteger(value / period))
    return group * count + Math.min(count - 1, Math.floor(latticeInteger((value - group * period) / size)))
}

function axisEnd(value: number, size: number, layout: Layout): number {
    if (!layout) return Math.ceil(latticeInteger(value / size))
    const [period, count] = layout
    const group = Math.floor(latticeInteger(value / period))
    return group * count + Math.min(count, Math.ceil(latticeInteger((value - group * period) / size)))
}

export function nodeBounds(layer: DisplayLayer, x: number, y: number, origin: [number, number]): Bounds {
    const [x0, x1] = axisBounds(x, layer.width, layer.xLayout)
    const [y0, y1] = axisBounds(y, layer.height, layer.yLayout)
    return [origin[0] + x0, origin[1] + y0, origin[0] + x1, origin[1] + y1]
}

export function nodeRange(layer: DisplayLayer, bounds: Bounds, origin: [number, number]): [number, number, number, number] {
    return [
        Math.max(layer.x0, axisIndex(bounds[0] - origin[0], layer.width, layer.xLayout)),
        Math.max(layer.y0, axisIndex(bounds[1] - origin[1], layer.height, layer.yLayout)),
        Math.min(layer.x0 + layer.nx, axisEnd(bounds[2] - origin[0], layer.width, layer.xLayout)),
        Math.min(layer.y0 + layer.ny, axisEnd(bounds[3] - origin[1], layer.height, layer.yLayout)),
    ]
}

/** Mirrors the server's layer_specs, including native resets for nonbinary ratios. */
export function displayLayers(bounds: Bounds, sizes: [number, number][], origin: [number, number], nativeOffset = 0): DisplayLayer[] {
    if (!sizes.length || sizes.some(size => size.some(value => !(value > 0) || !Number.isFinite(value)))) throw new Error('Invalid display schema cell sizes')
    const layers: DisplayLayer[] = []
    const append = (width: number, height: number, nativeLevel: number | null, xLayout: Layout = null, yLayout: Layout = null) => {
        const x0 = axisIndex(bounds[0] - origin[0], width, xLayout)
        const y0 = axisIndex(bounds[1] - origin[1], height, yLayout)
        layers.push({ width, height, x0, y0,
            nx: axisEnd(bounds[2] - origin[0], width, xLayout) - x0,
            ny: axisEnd(bounds[3] - origin[1], height, yLayout) - y0,
            nativeLevel, xLayout, yLayout })
    }
    for (let i = sizes.length - 1; i >= 0; i--) {
        const [w, h] = sizes[i]
        if (layers.length) {
            const { width: cw, height: ch } = layers[layers.length - 1]
            const rx = Math.round(w / cw), ry = Math.round(h / ch)
            if (rx < 1 || ry < 1 || Math.abs(w / cw - rx) > 1e-7 || Math.abs(h / ch - ry) > 1e-7 || Math.max(rx, ry) <= 1) throw new Error('Display schema must use nested integer lattices')
            let kx = 1, ky = 1
            while (Math.min(kx * 2, rx) !== rx || Math.min(ky * 2, ry) !== ry) {
                kx = Math.min(kx * 2, rx); ky = Math.min(ky * 2, ry)
                append(cw * kx, ch * ky, null, rx % kx ? [w, Math.ceil(rx / kx)] : null, ry % ky ? [h, Math.ceil(ry / ky)] : null)
            }
        }
        append(w, h, i + nativeOffset)
    }
    let [w, h] = sizes[0]
    do { w *= 2; h *= 2; append(w, h, null) } while (layers[layers.length - 1].nx > 2 || layers[layers.length - 1].ny > 2)
    return layers
}

/** The finite stored prefix continues as dyadic grid ancestors, without a zoom cap. */
export function displayLayer(layers: DisplayLayer[], index: number): DisplayLayer {
    if (!Number.isSafeInteger(index) || index < 0 || !layers.length) throw new Error('Invalid display layer')
    if (index < layers.length) return layers[index]
    const root = layers[layers.length - 1], depth = index - layers.length + 1
    const scale = (size: number) => {
        let remaining = depth
        while (remaining > 0) {
            const step = Math.min(remaining, 1023)
            size *= 2 ** step
            if (!Number.isFinite(size)) throw new Error('Display ancestor exceeds finite grid coordinates')
            remaining -= step
        }
        return size
    }
    const factor = 2 ** depth
    // Preserve the two sides of zero even when the scale exceeds float64.
    const lower = (value: number) => Number.isFinite(factor) ? Math.floor(value / factor) : value < 0 ? -1 : 0
    const upper = (value: number) => Number.isFinite(factor) ? Math.ceil(value / factor) : value > 0 ? 1 : 0
    const x0 = lower(root.x0), y0 = lower(root.y0)
    return { width: scale(root.width), height: scale(root.height), x0, y0,
        nx: upper(root.x0 + root.nx) - x0, ny: upper(root.y0 + root.ny) - y0,
        nativeLevel: null, xLayout: null, yLayout: null }
}

export function projectedCorners(bounds: Bounds, project: ProjectPoint): [number, number][] {
    return [[bounds[0], bounds[1]], [bounds[2], bounds[1]], [bounds[2], bounds[3]], [bounds[0], bounds[3]]]
        .map(point => project(point as [number, number]))
}

/** Largest inscribed circle of the convex four-corner node. With a finite
 * required radius, a feasible circle can prove acceptance before solving the LP.
 */
export function projectedRadius(bounds: Bounds, project: ProjectPoint, required = Infinity): number {
    return projectedCornerRadius(projectedCorners(bounds, project), required)
}

/** Same supporting-line solve, also used by scans sharing exact adjacent
 * vertices. A caller may reuse its scratch arrays between sequential nodes.
 */
export function projectedCornerRadius(corners: [number, number][], required = Infinity,
    scratch = { nx: [0, 0, 0, 0], ny: [0, 0, 0, 0], offsets: [0, 0, 0, 0] }): number {
    // Cancel world/screen translation before solving the supporting lines. This
    // also makes small Mercator nodes stable without camera-sized offsets.
    const ox = corners[0][0], oy = corners[0][1]
    const cx = ((corners[1][0] - ox) + (corners[2][0] - ox) + (corners[3][0] - ox)) / 4
    const cy = ((corners[1][1] - oy) + (corners[2][1] - oy) + (corners[3][1] - oy)) / 4
    const { nx, ny, offsets } = scratch
    let radius = Infinity
    for (let i = 0; i < 4; i++) {
        const p = corners[i]
        const q = corners[(i + 1) % 4]
        const length = Math.hypot(q[0] - p[0], q[1] - p[1])
        nx[i] = (p[1] - q[1]) / length; ny[i] = (q[0] - p[0]) / length
        const px = p[0] - ox, py = p[1] - oy
        if (nx[i] * (cx - px) + ny[i] * (cy - py) < 0) { nx[i] = -nx[i]; ny[i] = -ny[i] }
        offsets[i] = nx[i] * px + ny[i] * py
        radius = Math.min(radius, nx[i] * cx + ny[i] * cy - offsets[i])
    }
    if (radius >= required) return radius
    // A maximum circle is tangent to three supporting lines. Solve the four
    // possible triples, retaining only centers inside all four half-planes.
    for (let omitted = 0; omitted < 4; omitted++) {
        const a = (omitted + 1) % 4, b = (omitted + 2) % 4, c = (omitted + 3) % 4
        const ax = nx[a] - nx[c], ay = ny[a] - ny[c], av = offsets[a] - offsets[c]
        const bx = nx[b] - nx[c], by = ny[b] - ny[c], bv = offsets[b] - offsets[c]
        const determinant = ax * by - ay * bx
        if (Math.abs(determinant) < Number.EPSILON) continue
        const x = (av * by - ay * bv) / determinant
        const y = (ax * bv - av * bx) / determinant
        // The minimum distance is a feasible circle even at a roundoff boundary;
        // no absolute tolerance in projection-dependent units is needed here.
        let r = Infinity
        for (let i = 0; i < 4; i++) r = Math.min(r, nx[i] * x + ny[i] * y - offsets[i])
        if (r > radius) radius = r
        if (radius >= required) return radius
    }
    return radius
}

export function blockKey(block: DisplayBlock): string {
    return `${block.blockLayer}:${block.x}:${block.y}:${block.displayLayer}`
}

/** Partition visible space into hierarchical blocks, then choose each block's finest valid layer.
 * Projection is in CSS pixels. Only the four corners of a node are projected.
 */
export interface DisplayBlockMeasures {
    fits(bounds: Bounds): boolean
    size(bounds: Bounds): number
    layerFits(index: number, bounds: Bounds): boolean
}

export function selectDisplayBlocks(layers: DisplayLayer[], origin: [number, number], viewport: Bounds, project: ProjectPoint, measures?: DisplayBlockMeasures): DisplayBlock[] {
    const result: DisplayBlock[] = []
    const layer = (index: number) => displayLayer(layers, index)
    const fits = measures?.fits ?? ((bounds: Bounds) => projectedRadius(bounds, project) + 1e-9 >= NODE_RADIUS)
    const choose = (blockLayer: number, x: number, y: number) => {
        const bounds = nodeBounds(layer(blockLayer), x, y, origin)
        if (!intersects(bounds, viewport)) return
        const corners = measures ? [] : projectedCorners(bounds, project)
        const size = measures ? measures.size(bounds) : Math.max(...corners.map((p, i) => Math.hypot(p[0] - corners[(i + 1) % 4][0], p[1] - corners[(i + 1) % 4][1])))
        // Keep a theoretically 128-CSS-pixel edge on the same side of the
        // partition after a change of projection units and float64 roundoff.
        if (blockLayer > 0 && size > BLOCK_PIXELS + 1e-9) {
            const child = layer(blockLayer - 1)
            const [x0, y0, x1, y1] = nodeRange(child, bounds, origin)
            const children: [number, number][] = []
            for (let cy = y0; cy < y1; cy++) for (let cx = x0; cx < x1; cx++) {
                if (intersects(nodeBounds(child, cx, cy, origin), viewport)) children.push([cx, cy])
            }
            // A clipped strip can be too narrow even when its parent is large.
            if (children.every(([cx, cy]) => fits(nodeBounds(child, cx, cy, origin)))) {
                for (const [cx, cy] of children) choose(blockLayer - 1, cx, cy)
                return
            }
        }
        let selected = blockLayer
        for (let i = blockLayer - 1; i >= 0; i--) {
            if (measures) {
                if (!measures.layerFits(i, bounds)) break
                selected = i
                continue
            }
            const candidate = layer(i)
            const [x0, y0, x1, y1] = nodeRange(candidate, bounds, origin)
            let valid = true
            for (let cy = y0; cy < y1 && valid; cy++) for (let cx = x0; cx < x1; cx++) {
                if (!fits(nodeBounds(candidate, cx, cy, origin))) { valid = false; break }
            }
            if (!valid) break
            selected = i
        }
        result.push({ blockLayer, x, y, displayLayer: selected })
    }
    let last = layers.length - 1, top = layer(last)
    for (;;) {
        let valid = true
        for (let y = top.y0; y < top.y0 + top.ny && valid; y++) for (let x = top.x0; x < top.x0 + top.nx; x++) {
            const bounds = nodeBounds(top, x, y, origin)
            if (intersects(bounds, viewport) && !fits(bounds)) { valid = false; break }
        }
        if (valid) break
        top = layer(++last)
    }
    for (let y = top.y0; y < top.y0 + top.ny; y++) for (let x = top.x0; x < top.x0 + top.nx; x++) choose(last, x, y)
    return result
}
