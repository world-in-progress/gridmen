import { baseResponse, GetNodeInfoParams, LinkNodeParams, LinkNodeResponse, MountNodeParams, NodeMeta, PullNodeFromParams, PullNodeParams, PullResponse, PushNodeParams, UnlinkNodeParams } from './types'

const API_PREFIX = `/noodle/node`

export const getNodeInfo = async ({ node_key, child_start_index, child_end_index }: GetNodeInfoParams, leadIP?: string) => {
    if (leadIP) {
        node_key = `${leadIP}::${node_key}`
    }

    try {
        let url = `${API_PREFIX}?node_key=${node_key}&child_start_index=${child_start_index || 0}`
        if (child_end_index !== undefined) url += `&child_end_index=${child_end_index}`

        const response = await fetch(url, { method: "GET" })
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`)
        }

        const responseData: NodeMeta = await response.json()
        return responseData
    } catch (error) {
        throw new Error(`Failed to get node info: ${error}`)

    }
}

export const mountNode = async ({ node_key, template_name, mount_params_string }: MountNodeParams, leadIP?: string) => {
    if (leadIP) {
        node_key = `${leadIP}::${node_key}`
    }

    const url = `${API_PREFIX}/mount`

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ node_key, template_name, mount_params_string }),
        })
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`)
        }

        const responseData: string = await response.json()
        console.log(responseData)
        return responseData
    } catch (error) {
        throw new Error(`Failed to mount node: ${error}`)

    }
}

export const unmountNode = async (node_key: string, leadIP?: string) => {
    if (leadIP) {
        node_key = `${leadIP}::${node_key}`
    }

    const url = `${API_PREFIX}/unmount`

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ node_key }),
        })
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`)
        }

        const responseData: string = await response.json()
        return responseData
    } catch (error) {
        throw new Error(`Failed to unmount node: ${error}`)
    }
}

export const pushNode = async ({ template_name, source_node_key, target_node_key }: PushNodeParams, leadIP?: string) => {
    const url = `${API_PREFIX}/push?template_name=${template_name}&source_node_key=${source_node_key}&target_node_key=${target_node_key}`

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ template_name, source_node_key, target_node_key }),
        })

        const responseData: baseResponse = await response.json()
        return responseData
    } catch (error) {
        throw new Error(`Failed to push node: ${error}`)
    }
}

export const pullNode = async ({ template_name, target_node_key, source_node_key, mount_params }: PullNodeParams, leadIP?: string) => {
    const url = `${API_PREFIX}/pull?template_name=${template_name}&target_node_key=${target_node_key}&source_node_key=${source_node_key}&mount_params=${mount_params}`

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ template_name, target_node_key, source_node_key, mount_params }),
        })

        const responseData: PullResponse = await response.json()
        return responseData

    } catch (error) {
        throw new Error(`Failed to pull node: ${error}`)

    }
}

export const pullFrom = async ({ template_name, target_node_key, source_node_key, chunk_index, chunk_data, is_last_chunk }: PullNodeFromParams, leadIP?: string) => {
    const url = `${API_PREFIX}/pull_from?template_name=${template_name}&target_node_key=${target_node_key}&source_node_key=${source_node_key}&chunk_data=${chunk_data}&chunk_index=${chunk_index}&is_last_chunk=${is_last_chunk}`

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ template_name, target_node_key, source_node_key, chunk_index, chunk_data, is_last_chunk }),
        })
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`)
        }

        const responseData: string = await response.json()
        return responseData
    } catch (error) {
        throw new Error(`Failed to pull from: ${error}`)
    }
}

export const linkNode = async ({ icrm_tag, node_key, access_mode }: LinkNodeParams, leadIP?: string) => {
    const url = `${API_PREFIX}/link?icrm_tag=${icrm_tag}&node_key=${node_key}&access_mode=${access_mode}`

    try {
        const response = await fetch(url, { method: 'GET' })

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`)
        }

        const responseData: LinkNodeResponse = await response.json()
        return responseData
    } catch (error) {
        throw new Error(`Failed to link node: ${error}`)
    }
}

export const UnlinkNode = async ({ node_key, lock_id }: UnlinkNodeParams, leadIP?: string) => {
    const url = `${API_PREFIX}/unlink?node_key=${node_key}&lock_id=${lock_id}`

    try {
        const response = await fetch(url, { method: 'GET' })

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`)
        }

        const responseData: { success: boolean } = await response.json()
        return responseData
    } catch (error) {
        throw new Error(`Failed to unlink node: ${error}`)
    }
}