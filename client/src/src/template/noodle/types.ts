export interface GetTreeNodeInfoParams {
    node_key: string
    child_start_index?: number
    child_end_index?: number
}

export interface SceneMeta {
    node_key: string
    access_info: string | null
    template_name: string
    children: SceneMeta[] | null
}

export interface baseResponse {
    success: boolean
    message: string
}