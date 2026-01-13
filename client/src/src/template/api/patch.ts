import { useSettingStore } from "@/store/storeSet"
import { extractIPFromUrl, getApiBaseUrl } from "./utils"
import { PatchMeta } from "./types"
import { MultiGridInfoParser } from "@/core/grid/types"

const API_PREFIX = `/api/patch`

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