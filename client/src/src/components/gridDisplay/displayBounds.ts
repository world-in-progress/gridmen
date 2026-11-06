import proj4 from 'proj4'
import type { Bounds } from '@/core/grid/displayTypes'
import { getProj4Defs } from '@/template/api/proj'
import { gridDisplayI18n } from '@/i18n/gridDisplay'

export async function displayBoundsOn4326(bounds: Bounds, epsg: number): Promise<Bounds> {
    const invalid = () => new Error(gridDisplayI18n.t('boundsTransformError'))
    if (!bounds.every(Number.isFinite) || bounds[0] >= bounds[2] || bounds[1] >= bounds[3]) throw invalid()
    if (epsg === 4326) return [...bounds]
    const definition = await getProj4Defs(epsg)
    if (!definition) throw invalid()
    const projection = proj4(definition, 'EPSG:4326')
    const points = [
        projection.forward([bounds[0], bounds[1]]), projection.forward([bounds[2], bounds[1]]),
        projection.forward([bounds[0], bounds[3]]), projection.forward([bounds[2], bounds[3]]),
    ]
    if (points.some(point => !point.every(Number.isFinite))) throw invalid()
    return [Math.min(...points.map(point => point[0])), Math.min(...points.map(point => point[1])),
        Math.max(...points.map(point => point[0])), Math.max(...points.map(point => point[1]))]
}
