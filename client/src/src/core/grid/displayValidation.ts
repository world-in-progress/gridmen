import type { Bounds, GridDisplayMeta } from './displayTypes'

function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function positive(value: unknown): value is number { return finite(value) && value > 0 }
function integer(value: unknown): value is number { return finite(value) && Number.isSafeInteger(value) && value >= 0 }
function bounds(value: unknown): value is Bounds {
    return Array.isArray(value) && value.length === 4 && value.every(finite) && value[0] < value[2] && value[1] < value[3]
}
function pair(value: unknown): value is [number, number] { return Array.isArray(value) && value.length === 2 && value.every(finite) }

/** Validate HTTP metadata once, before deriving the runtime hierarchy. */
export function validateDisplayMeta(value: unknown): asserts value is Omit<GridDisplayMeta, 'displayLayers'> {
    const meta = value as Omit<GridDisplayMeta, 'displayLayers'> | null
    if (!meta || typeof meta.revision !== 'string' || !meta.revision || !integer(meta.epsg) || meta.epsg === 0 || !bounds(meta.bounds)
        || !Array.isArray(meta.landClasses) || meta.landClasses.some((category, index) => !integer(category) || (index > 0 && category <= meta.landClasses[index - 1]))
        || !pair(meta.alignment_origin) || !pair(meta.elevationRange) || meta.elevationRange[0] > meta.elevationRange[1]
        || !Array.isArray(meta.grid_info) || !meta.grid_info.length || meta.grid_info.some(pitch => !pair(pitch) || !pitch.every(positive))) {
        throw new Error('Invalid grid display metadata')
    }
}
