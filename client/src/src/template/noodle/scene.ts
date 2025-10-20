import { GetTreeNodeInfoParams, SceneMeta } from './types'

const API_PREFIX = '/api/scene'

export const getTreeNodeInfo = async ({ node_key, child_start_index, child_end_index }: GetTreeNodeInfoParams) => {
    try {
        let url = `${API_PREFIX}?node_key=${node_key}&child_start_index=${child_start_index || 0}`
        if (child_end_index !== undefined) url += `&child_end_index=${child_end_index}`

        const response = await fetch(url, { method: "GET" })
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`)
        }

        const responseData: SceneMeta = await response.json()
        return responseData
    } catch (error) {
        throw new Error(`Failed to get tree node info: ${error}`)

    }
}