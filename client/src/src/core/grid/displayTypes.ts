/** Shared display contract. Geometry is always expressed in the grid CRS. */
export type Bounds = [number, number, number, number]

export type DisplayAttribute = 'level' | 'elevation' | 'landClass'

export interface DisplayLayer {
    width: number
    height: number
    x0: number
    y0: number
    nx: number
    ny: number
    nativeLevel: number | null
    /** A dyadic interval resets at each native parent; the last strip is clipped. */
    xLayout: [number, number] | null
    yLayout: [number, number] | null
}

/** A complete grid-coordinate node, sampled at a finer display layer. */
export interface DisplayBlock {
    blockLayer: number
    x: number
    y: number
    displayLayer: number
}

export interface GridDisplayMeta {
    revision: string
    displayLayers: DisplayLayer[]
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
    loadBlocks(blocks: DisplayBlock[], signal: AbortSignal, decode?: DisplayBlockDecoder): Promise<GridDisplayView>
    clearCache?(): void
    retainBlocks?(blocks: DisplayBlock[], stopped: boolean): void
    reportError?(error: unknown): void
    inspect(x: number, y: number): Promise<GridInspection>
}

export type DisplayBlockDecoder = (blocks: { block: DisplayBlock; buffer: ArrayBuffer }[]) => Promise<DisplayChunk[]>

export interface DisplayStats {
    /** Bytes allocated by this renderer's buffers and textures. */
    gpuBytes: number
    visibleChunks: number
    visibleCells: number
    fieldSamples: number
    fieldMode: boolean
    ready: boolean
}
