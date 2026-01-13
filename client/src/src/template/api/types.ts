export interface GetNodeInfoParams {
    node_key: string
    child_start_index?: number
    child_end_index?: number
}

export interface NodeMeta {
    node_key: string
    access_info: string | null
    template_name: string
    children: NodeMeta[] | null
}

export interface baseResponse {
    success: boolean
    message: string
}

export interface MountNodeParams {
    node_key: string
    template_name: string | null
    mount_params_string: string | null
}

export interface PushPullNodeParams {
    template_name: string
    source_node_key: string
    target_node_key: string
}

export interface PullResponse extends baseResponse {
    target_node_key: string
}

export interface LinkNodeParams {
    icrm_tag: string
    node_key: string
    access_mode: 'r' | 'w'
}

export interface LinkNodeResponse {
    lock_id: string
    node_key: string
    lock_type: string
    access_mode: string
}

export interface UnlinkNodeParams {
    node_key: string
    lock_id: string
}

export interface PatchMeta {
    name: string
    epsg: number
    starred: boolean
    description: string
    alignment_origin: [number, number]
    subdivide_rules: [number, number][]
    bounds: [number, number, number, number]
}