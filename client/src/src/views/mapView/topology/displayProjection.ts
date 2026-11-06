import type { Map as MapboxMap } from 'mapbox-gl'
import type { Converter } from 'proj4/dist/lib/core'
import type { Bounds } from '../../../core/grid/displayTypes'
import { MercatorCoordinate } from '../../../core/math/mercatorCoordinate'

export interface DisplayCamera {
    bounds: Bounds
    metersPerPixel: number
}

export function gridPoint(map: MapboxMap, projection: Converter, point: [number, number]): [number, number] {
    const lngLat = map.unproject(point)
    return projection.inverse([lngLat.lng, lngLat.lat]) as [number, number]
}

/** The public zero-pitch, zero-bearing camera uses CSS coordinates for widths. */
export function displayCamera(map: MapboxMap, projection: Converter): DisplayCamera {
    const canvas = map.getCanvas()
    const width = Math.max(1, canvas.clientWidth), height = Math.max(1, canvas.clientHeight)
    const corners = [[0, 0], [width, 0], [width, height], [0, height]] as [number, number][]
    const points = corners.map(point => gridPoint(map, projection, point))
    if (points.some(point => !point.every(Number.isFinite))) throw new Error('Camera does not intersect finite grid coordinates')
    const bounds: Bounds = [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))]
    const center = gridPoint(map, projection, [width / 2, height / 2])
    const steps = [[width / 2 + 1, height / 2], [width / 2, height / 2 + 1]] as [number, number][]
    const metersPerPixel = Math.min(...steps.map(point => {
        const adjacent = gridPoint(map, projection, point)
        return Math.hypot(adjacent[0] - center[0], adjacent[1] - center[1])
    }))
    if (!(metersPerPixel > 0) || !Number.isFinite(metersPerPixel)) throw new Error('Invalid camera scale')
    return { bounds, metersPerPixel }
}

export function mercatorPoint(projection: Converter, point: [number, number]): [number, number] {
    return MercatorCoordinate.fromLonLat(projection.forward(point) as [number, number])
}

/** Cancel the large world translation in double precision before uploading floats. */
export function chunkMatrix(matrix: ArrayLike<number>, origin: [number, number]): Float32Array {
    const result = Float32Array.from(matrix)
    for (let row = 0; row < 4; row++) {
        result[12 + row] = matrix[row] * origin[0] + matrix[4 + row] * origin[1] + matrix[12 + row]
    }
    return result
}

export function intersects(a: Bounds, b: Bounds): boolean {
    return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]
}

export function chunkOnScreen(map: MapboxMap, projection: Converter, bounds: Bounds): boolean {
    const corners = [[bounds[0], bounds[1]], [bounds[2], bounds[1]], [bounds[2], bounds[3]], [bounds[0], bounds[3]]]
    const screen = corners.map(xy => map.project(projection.forward(xy) as [number, number]))
    const canvas = map.getCanvas()
    return Math.max(...screen.map(p => p.x)) >= 0 && Math.min(...screen.map(p => p.x)) <= canvas.clientWidth
        && Math.max(...screen.map(p => p.y)) >= 0 && Math.min(...screen.map(p => p.y)) <= canvas.clientHeight
}

/** Projected-cell intersection with a screen selection box. */
export function polygonIntersectsBox(polygon: [number, number][], box: Bounds): boolean {
    const rectangle = [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]]
    const axes: [number, number][] = [[1, 0], [0, 1]]
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i]
        const b = polygon[(i + 1) % polygon.length]
        axes.push([a[1] - b[1], b[0] - a[0]])
    }
    return axes.every(([x, y]) => {
        const a = polygon.map(p => p[0] * x + p[1] * y)
        const b = rectangle.map(p => p[0] * x + p[1] * y)
        return Math.max(...a) > Math.min(...b) && Math.max(...b) > Math.min(...a)
    })
}
