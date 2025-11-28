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

export interface PullResponse {
    success: boolean
    message: string
    target_node_key: string
}