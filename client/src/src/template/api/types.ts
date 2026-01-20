export type MultiCellBaseInfo = {
    levels: Uint8Array;
    globalIds: Uint32Array;
    deleted?: Uint8Array;
}

export interface GetNodeMetaInfoParams {
    nodeInfo: string
    childStartIndex?: number
    childEndIndex?: number
}

export interface NodeMeta {
    node_key: string
    access_info: string | null
    template_name: string
    children: NodeMeta[] | null
}

export interface BaseResponse {
    success: boolean
    message: string
}

export interface MountNodeParams {
    nodeInfo: string
    templateName: string | null
    mountParamsString: string | null
}

export interface PushPullNodeParams {
    template_name: string
    source_node_key: string
    target_node_key: string
}

export interface PullResponse extends BaseResponse {
    target_node_key: string
}

export interface LinkNodeResponse {
    lock_id: string
    node_key: string
    lock_type: string
    access_mode: string
}

export interface PatchMeta {
    name: string
    epsg: number
    starred: boolean
    description: string
    alignment_origin: [number, number]
    subdivide_rules: [number, number][]
    bounds: [number, number, number, number]
    schema_node_key: string
    grid_info: [number, number][]
}

export interface VectorFileInfo {
    filePath: string
    fileType: string
}

export interface VectorDataResponse extends BaseResponse {
    data: Record<string, any>
}

export interface VectorJsonComputionResponse extends BaseResponse {
    feature_json: Record<string, any>
}

export interface UpdateVectorData {
    color: string
    epsg: string
    feature_json: Record<string, any>
}