import {
    BaseResponse,
    GetNodeMetaInfoParams,
    LinkNodeResponse,
    MountNodeParams,
    NodeMeta,
    PushPullNodeParams,
    PullResponse,
} from './types'
// import { useSettingStore } from '@/store/storeSet'
import { decodeNodeInfo } from './utils'

const API_PREFIX = `/noodle/node`

export const getNodeBasicInfo = async ({ nodeInfo, childStartIndex, childEndIndex }: GetNodeMetaInfoParams) => {
    try {
        const { address, nodeKey } = decodeNodeInfo(nodeInfo)
        let url = `${address}${API_PREFIX}?node_key=${nodeKey}&child_start_index=${childStartIndex || 0}`
        if (childEndIndex !== undefined) url += `&child_end_index=${childEndIndex}`
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

export const mountNode = async ({ nodeInfo, templateName, mountParamsString }: MountNodeParams) => {
    const { address, nodeKey } = decodeNodeInfo(nodeInfo)
    const url = `${address}${API_PREFIX}/mount`

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ node_key: nodeKey, template_name: templateName, mount_params_string: mountParamsString }),
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

export const unmountNode = async (nodeInfo: string) => {
    const { address, nodeKey } = decodeNodeInfo(nodeInfo)
    const url = `${address}${API_PREFIX}/unmount?node_key=${nodeKey}`

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

export const pushNode = async ({ template_name, source_node_key, target_node_key: targetNodeInfo }: PushPullNodeParams) => {
    const { address: sourceAddress, nodeKey: sourceNodeKey } = decodeNodeInfo(source_node_key)
    const url = `${sourceAddress}${API_PREFIX}/push?template_name=${template_name}&source_node_key=${sourceNodeKey}&target_node_key=${targetNodeInfo}`

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
        })

        const responseData: BaseResponse = await response.json()
        return responseData
    } catch (error) {
        throw new Error(`Failed to push node: ${error}`)
    }
}

export const pullNode = async ({ template_name, target_node_key, source_node_key: sourceNodeInfo }: PushPullNodeParams) => {
    const { address: targetAddress, nodeKey: targetNodeKey } = decodeNodeInfo(target_node_key)
    const url = `${targetAddress}${API_PREFIX}/pull?template_name=${template_name}&target_node_key=${targetNodeKey}&source_node_key=${sourceNodeInfo}`

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
        })

        const responseData: PullResponse = await response.json()
        return responseData

    } catch (error) {
        throw new Error(`Failed to pull node: ${error}`)
    }
}

export const getNodeParams = async (nodeInfo: string) => {
    const { address, nodeKey } = decodeNodeInfo(nodeInfo)
    const url = `${address}${API_PREFIX}/mount_params?node_key=${nodeKey}`

    try {
        const response = await fetch(url, { method: "GET" })
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`)
        }
        const responseData: unknown = await response.json()
        return responseData
    } catch (error) {
        throw new Error(`Failed to get node params: ${error}`)
    }
}

export const linkNode = async (icrmTag: string, nodeInfo: string, accessMode: 'r' | 'w') => {
    const { address, nodeKey } = decodeNodeInfo(nodeInfo)
    const url = `${address}${API_PREFIX}/link?icrm_tag=${icrmTag}&node_key=${nodeKey}&access_mode=${accessMode}`

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

export const unlinkNode = async (nodeInfo: string, lock_id: string) => {
    const { address, nodeKey } = decodeNodeInfo(nodeInfo)
    const url = `${address}${API_PREFIX}/unlink?node_key=${nodeKey}&lock_id=${lock_id}`

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