import { useSettingStore } from "@/store/storeSet"
import { extractIPFromUrl, getApiBaseUrl } from "./utils"

const API_PREFIX = `/api/patch`

interface PatchMeta {
    name: string
    epsg: number
    alignment_origin: [number, number]
    subdivide_rules: [number, number][]
    bounds: [number, number, number, number]
}

export const getPatchMeta = async (node_key: string, lock_id: string, leadIP?: boolean) => {
    if (leadIP) {
        const publicIP = useSettingStore.getState().publicIP
        const ipPrefix = extractIPFromUrl(publicIP || '127.0.0.1:8000')
        node_key = `${ipPrefix}::${node_key}`
    }

    const baseUrl = getApiBaseUrl(leadIP || false)
    const url = `${baseUrl}${API_PREFIX}/api/patch/meta?node_key=${node_key}&lock_id=${lock_id}`

    try {
        const response = await fetch(url, { method: 'GET' })
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`)
        }
        const responseData: string = await response.json()
        return responseData
    } catch (error) {
        throw new Error(`Failed to get patch meta: ${error}`)
    }
}