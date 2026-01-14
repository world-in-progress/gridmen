import { useSettingStore } from "@/store/storeSet"
import { extractIPFromUrl, getApiBaseUrl } from "./utils"
import IAPI, { BaseResponse, MultiGridBaseInfo, PatchMeta } from "./types"
import { MultiGridInfoParser } from "@/core/grid/types"

const API_PREFIX = `/api/patch`
const UNDELETED_FLAG = 0

export const getPatchMeta = async (node_key: string, lock_id: string, leadIP?: boolean) => {
    if (leadIP) {
        const publicIP = useSettingStore.getState().publicIP
        const ipPrefix = extractIPFromUrl(publicIP || '127.0.0.1:8000')
        node_key = `${ipPrefix}::${node_key}`
    }

    const baseUrl = getApiBaseUrl(leadIP || false)
    const url = `${baseUrl}${API_PREFIX}/meta?node_key=${node_key}&lock_id=${lock_id}`

    try {
        const response = await fetch(url, { method: 'GET' })
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`)
        }
        const responseData: PatchMeta = await response.json()
        return responseData
    } catch (error) {
        throw new Error(`Failed to get patch meta: ${error}`)
    }
}

export const activateGridInfo = async (node_key: string, lock_id: string) => {


    const baseUrl = getApiBaseUrl(false)
    const url = `${baseUrl}${API_PREFIX}/activate-info?node_key=${node_key}&lock_id=${lock_id}`
    console.log('activateGridInfo url', url)

    try {
        const response = await fetch(url, { method: 'GET' })
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`)
        }
        const buffer = await response.arrayBuffer()
        return MultiGridInfoParser.fromBuffer(buffer)
    } catch (error) {
        throw new Error(`Failed to activate info: ${error}`)
    }
}

export const deletedGridInfo = async (node_key: string, lock_id: string) => {

    const baseUrl = getApiBaseUrl(false)
    const url = `${baseUrl}${API_PREFIX}/deleted-info?node_key=${node_key}&lock_id=${lock_id}`

    console.log('deletedGridInfo url', url)

    try {
        const response = await fetch(url, { method: 'GET' })
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`)
        }
        const buffer = await response.arrayBuffer()
        return MultiGridInfoParser.fromBuffer(buffer)
    } catch (error) {
        throw new Error(`Failed to activate info: ${error}`)
    }
}

export const subdivideGrids: IAPI<MultiGridBaseInfo, MultiGridBaseInfo> = {
    fetch: async (query: MultiGridBaseInfo, node_key: string, lock_id: string): Promise<MultiGridBaseInfo> => {
        try {
            const baseUrl = getApiBaseUrl(false)
            const url = `${baseUrl}${API_PREFIX}/subdivide?node_key=${node_key}&lock_id=${lock_id}`
            const buffer = MultiGridInfoParser.toBuffer(query)
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: buffer,
            })

            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`)
            }

            const resBuffer = await response.arrayBuffer()
            return MultiGridInfoParser.fromBuffer(resBuffer)

        } catch (error) {
            throw new Error(`Failed to subdivide grids: ${error}`)
        }
    }
}

export const mergeGrids: IAPI<MultiGridBaseInfo, MultiGridBaseInfo> = {
    fetch: async (query: MultiGridBaseInfo, node_key: string, lock_id: string): Promise<MultiGridBaseInfo> => {
        try {
            const baseUrl = getApiBaseUrl(false)
            const url = `${baseUrl}${API_PREFIX}/merge?node_key=${node_key}&lock_id=${lock_id}`
            const buffer = MultiGridInfoParser.toBuffer(query)
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: buffer,
            })

            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`)
            }

            const resBuffer = await response.arrayBuffer()
            const parentInfo = MultiGridInfoParser.fromBuffer(resBuffer)
            parentInfo.deleted = new Uint8Array(parentInfo.levels.length).fill(UNDELETED_FLAG)
            return parentInfo

        } catch (error) {
            throw new Error(`Failed to merge grids: ${error}`)
        }
    }
}

export const deleteGrids: IAPI<MultiGridBaseInfo, void> = {
    fetch: async (query: MultiGridBaseInfo, node_key: string, lock_id: string): Promise<void> => {
        try {
            const baseUrl = getApiBaseUrl(false)
            const url = `${baseUrl}${API_PREFIX}/delete?node_key=${node_key}&lock_id=${lock_id}`
            const buffer = MultiGridInfoParser.toBuffer(query)
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: buffer,
            })

            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`)
            }

        } catch (error) {
            throw new Error(`Failed to remove grids: ${error}`)
        }
    }
}

export const recoverGrids: IAPI<MultiGridBaseInfo, void> = {
    fetch: async (query: MultiGridBaseInfo, node_key: string, lock_id: string): Promise<void> => {
        try {
            const baseUrl = getApiBaseUrl(false)
            const url = `${baseUrl}${API_PREFIX}/recover?node_key=${node_key}&lock_id=${lock_id}`
            const buffer = MultiGridInfoParser.toBuffer(query)
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: buffer,
            })

            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`)
            }
        } catch (error) {
            throw new Error(`Failed to recover grids: ${error}`)
        }
    }
}

export const pickGridsByFeature: IAPI<string, MultiGridBaseInfo> = {
    fetch: async (featureDir: string, node_key: string, lock_id: string): Promise<MultiGridBaseInfo> => {
        try {
            const baseUrl = getApiBaseUrl(false)
            const url = `${baseUrl}${API_PREFIX}/pick?node_key=${node_key}&lock_id=${lock_id}`
            const response = await fetch(`${url}?feature_dir=${featureDir}`, { method: 'GET' })

            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`)
            }

            const buffer = await response.arrayBuffer()
            return MultiGridInfoParser.fromBuffer(buffer)

        } catch (error) {
            throw new Error(`Failed to pick grids by feature: ${error}`)
        }
    }
}

export const saveGrids: IAPI<void, BaseResponse> = {
    fetch: async (_: void, node_key: string, lock_id: string): Promise<BaseResponse> => {
        try {
            const baseUrl = getApiBaseUrl(false)
            const url = `${baseUrl}${API_PREFIX}/pick?node_key=${node_key}&lock_id=${lock_id}`
            const response = await fetch(url, { method: 'GET' })
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`)
            }
            const gridInfo = await response.json()
            return gridInfo

        } catch (error) {
            throw new Error(`Failed to save grids: ${error}`)
        }
    }
}