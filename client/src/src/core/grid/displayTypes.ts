/** Shared display contract. Geometry is always expressed in the grid CRS. */
export type Bounds = [number, number, number, number]

export type DisplayAttribute = 'level' | 'elevation' | 'landClass'

export interface GridDisplayMeta {
    epsg: number
    bounds: Bounds
    grid_info: [number, number][]
    level_info: { width: number; height: number }[]
    subdivide_rules: [number, number][]
    alignment_origin: [number, number]
    cellCount: number
    attributes: DisplayAttribute[]
    elevationRange: [number, number]
    landClasses: number[]
}

export interface DisplayCell {
    id: number
    bounds: Bounds
    level: number
    elevation: number
    landClass: number
    deleted?: boolean
}

export interface DisplayField {
    bounds: Bounds
    occupiedFraction: number
    minCellSize: number
    level: number
    elevation: number
    landClass: number
}

export interface DisplayChunk {
    key: string
    bounds: Bounds
    cells: DisplayCell[]
    fields: DisplayField[]
}

export interface GridDisplayView {
    chunks: DisplayChunk[]
    /** Number of original cells, including those represented by summaries. */
    cellCount: number
}

export interface GridInspection {
    cell: DisplayCell | null
    neighbors: {
        side: 'west' | 'east' | 'south' | 'north'
        cell: DisplayCell
        edgeIds: number[]
    }[]
}

export interface ReadOnlyGridSource {
    meta: GridDisplayMeta
    loadView(bounds: Bounds, metersPerPixel: number, signal: AbortSignal): Promise<GridDisplayView>
    inspect(x: number, y: number): Promise<GridInspection>
}

export interface DisplayStats {
    /** Bytes allocated by this renderer's buffers and textures. */
    gpuBytes: number
    visibleChunks: number
    visibleCells: number
    fieldSamples: number
    fieldMode: boolean
    ready: boolean
}
