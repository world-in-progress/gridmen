import {
    BaseResponse,
    GetNodeInfoParams,
    LinkNodeParams,
    LinkNodeResponse,
    MountNodeParams,
    NodeMeta,
    PushPullNodeParams,
    PullResponse,
    UnlinkNodeParams
} from './types'
import { useSettingStore } from '@/store/storeSet'
import { extractIPFromUrl, getApiBaseUrl } from './utils'

const API_PREFIX = `/noodle/node`



export const getNodeInfo = async ({ node_key, child_start_index, child_end_index }: GetNodeInfoParams, leadIP?: boolean) => {
    try {
        const baseUrl = getApiBaseUrl(leadIP || false)
        let url = `${baseUrl}${API_PREFIX}?node_key=${node_key}&child_start_index=${child_start_index || 0}`
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

export const mountNode = async ({ node_key, template_name, mount_params_string }: MountNodeParams, leadIP?: boolean) => {
    if (leadIP) {
        const publicIP = useSettingStore.getState().publicIP
        const ipPrefix = extractIPFromUrl(publicIP || '127.0.0.1:8000')
        node_key = `${ipPrefix}::${node_key}`
    }

    const baseUrl = getApiBaseUrl(leadIP || false)
    const url = `${baseUrl}${API_PREFIX}/mount`

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

export const unmountNode = async (node_key: string, leadIP?: boolean) => {
    if (leadIP) {
        const publicIP = useSettingStore.getState().publicIP
        const ipPrefix = extractIPFromUrl(publicIP || '127.0.0.1:8000')
        node_key = `${ipPrefix}::${node_key}`
    }

    const baseUrl = getApiBaseUrl(leadIP || false)
    const url = `${baseUrl}${API_PREFIX}/unmount?node_key=${node_key}`

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
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

export const pushNode = async ({ template_name, source_node_key, target_node_key }: PushPullNodeParams) => {
    const baseUrl = getApiBaseUrl(false)
    const remoteUrl = getApiBaseUrl(true)
    const remoteTargetNodeKey = `${remoteUrl}::${target_node_key}`
    const url = `${baseUrl}${API_PREFIX}/push?template_name=${template_name}&source_node_key=${source_node_key}&target_node_key=${remoteTargetNodeKey}`

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ template_name, source_node_key, remoteTargetNodeKey }),
        })

        const responseData: BaseResponse = await response.json()
        return responseData
    } catch (error) {
        throw new Error(`Failed to push node: ${error}`)
    }
}

export const pullNode = async ({ template_name, target_node_key, source_node_key }: PushPullNodeParams) => {
    const baseUrl = getApiBaseUrl(false)
    const remoteUrl = getApiBaseUrl(true)
    const url = `${baseUrl}${API_PREFIX}/pull?template_name=${template_name}&target_node_key=${target_node_key}&source_node_key=${remoteUrl}::${source_node_key}`

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ template_name, target_node_key, source_node_key }),
        })

        const responseData: PullResponse = await response.json()
        return responseData

    } catch (error) {
        throw new Error(`Failed to pull node: ${error}`)
    }
}

export const getNodeParams = async (node_key: string, isRemote: boolean) => {
    const baseUrl = getApiBaseUrl(isRemote)
    const url = `${baseUrl}${API_PREFIX}/mount_params?node_key=${node_key}`

    try {
        const response = await fetch(url, { method: "GET" })
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`)
        }
        const responseData: any = await response.json()
        return responseData
    } catch (error) {
        throw new Error(`Failed to get node params: ${error}`)
    }
}

export const linkNode = async (icrm_tag: string, node_key: string, access_mode: 'r' | 'w', leadIP?: boolean) => {
    const baseUrl = getApiBaseUrl(leadIP || false)
    const url = `${baseUrl}${API_PREFIX}/link?icrm_tag=${icrm_tag}&node_key=${node_key}&access_mode=${access_mode}`

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

export const unlinkNode = async (node_key: string, lock_id: string, leadIP?: boolean) => {
    const baseUrl = getApiBaseUrl(leadIP || false)
    const url = `${baseUrl}${API_PREFIX}/unlink?node_key=${node_key}&lock_id=${lock_id}`

    try {
        const response = await fetch(url, { method: 'GET' })
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`)
        }
        const responseData: BaseResponse = await response.json()
        return responseData
    } catch (error) {
        throw new Error(`Failed to unlink node: ${error}`)
    }
}