export interface GridLayerInfo {
    id: number
    width: string
    height: string
}

export interface SchemaData {
    name: string
    epsg: number
    alignment_origin: [number, number]
    grid_info: [number, number][]
}