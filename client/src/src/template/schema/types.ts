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

export interface FormErrors {
    name: boolean
    epsg: boolean
    coordinates: boolean
}

export interface ValidationResult {
    isValid: boolean
    errors: FormErrors
    generalError: string | null
}