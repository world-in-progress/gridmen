import type { Bounds, DisplayCell, GridDisplayMeta, GridDisplayView } from './displayTypes'

function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function positive(value: unknown): value is number { return finite(value) && value > 0 }
function integer(value: unknown): value is number { return finite(value) && Number.isSafeInteger(value) && value >= 0 }
function bounds(value: unknown): value is Bounds {
    return Array.isArray(value) && value.length === 4 && value.every(finite) && value[0] < value[2] && value[1] < value[3]
}
function pair(value: unknown): value is [number, number] { return Array.isArray(value) && value.length === 2 && value.every(finite) }
function cell(value: DisplayCell): boolean {
    return !!value && integer(value.id) && bounds(value.bounds) && integer(value.level) && finite(value.elevation) && integer(value.landClass)
        && (value.deleted === undefined || typeof value.deleted === 'boolean')
}

/** Fail at the source boundary; rendering code can then trust its samples. */
export function validateDisplayMeta(meta: GridDisplayMeta): void {
    if (!meta || !integer(meta.epsg) || meta.epsg === 0 || !bounds(meta.bounds) || !integer(meta.cellCount)
        || !Array.isArray(meta.landClasses) || meta.landClasses.some((category, index) => !integer(category) || (index > 0 && category <= meta.landClasses[index - 1]))
        || !pair(meta.alignment_origin) || !pair(meta.elevationRange) || meta.elevationRange[0] > meta.elevationRange[1]
        || !Array.isArray(meta.attributes) || meta.attributes.some(attribute => !['level', 'elevation', 'landClass'].includes(attribute))
        || !Array.isArray(meta.grid_info) || !meta.grid_info.length || meta.grid_info.some(pitch => !pair(pitch) || !pitch.every(positive))
        || !Array.isArray(meta.level_info) || meta.level_info.some(level => !level || !integer(level.width) || !integer(level.height) || !positive(level.width) || !positive(level.height))
        || !Array.isArray(meta.subdivide_rules) || meta.subdivide_rules.some(rule => !pair(rule) || !rule.every(value => integer(value) && value > 0))) {
        throw new Error('Invalid grid display metadata')
    }
}

export function validateDisplayView(view: GridDisplayView): void {
    if (!view || !integer(view.cellCount) || !Array.isArray(view.chunks)) throw new Error('Invalid grid display response')
    const keys = new Set<string>()
    for (const chunk of view.chunks) {
        if (!chunk || typeof chunk.key !== 'string' || !chunk.key || keys.has(chunk.key) || !bounds(chunk.bounds) || !Array.isArray(chunk.cells) || !Array.isArray(chunk.fields)) throw new Error('Invalid grid display chunk')
        keys.add(chunk.key)
        if (chunk.cells.some(value => !cell(value))) throw new Error('Invalid original display cell')
        for (const field of chunk.fields) {
            if (!field || !bounds(field.bounds) || !positive(field.occupiedFraction) || field.occupiedFraction > 1
                || !positive(field.minCellSize) || !integer(field.level) || !finite(field.elevation) || !integer(field.landClass)) throw new Error('Invalid grid display field')
        }
    }
}
