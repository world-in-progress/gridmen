import { GetNodeInfoParams, MountNodeParams, NodeMeta, PullResponse } from './types'

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

export const pullNode = async (template_name: string, target_node_key: string, source_node_key: string, mount_params: string) => {
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

export const pullFrom = async (node_key: string) => {
    const url = `${API_PREFIX}/pull_from?node_key=${node_key}`

    try {
        const response = await fetch(url, {
            method: 'GET',
        })
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`)
        }

        return response.body
    } catch (error) {
        throw new Error(`Failed to pull from: ${error}`)
    }
}