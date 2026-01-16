import { decodeNodeInfo } from './utils'
import { MultiCellInfoParser } from '@/core/grid/types'
import { BaseResponse, MultiCellBaseInfo, PatchMeta } from './types'

const API_PREFIX = `/api/patch`
const UNDELETED_FLAG = 0

export const getPatchMeta = async (nodeInfo: string, lockId: string) => {
    const { address, nodeKey } = decodeNodeInfo(nodeInfo)
    const url = `${address}${API_PREFIX}/meta?node_key=${nodeKey}&lock_id=${lockId}`

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

export const activateCellInfo = async (nodeInfo: string, lockId: string) => {
    const { address, nodeKey } = decodeNodeInfo(nodeInfo)
    const url = `${address}${API_PREFIX}/activate-info?node_key=${nodeKey}&lock_id=${lockId}`

    try {
        const response = await fetch(url, { method: 'GET' })
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`)
        }
        const buffer = await response.arrayBuffer()
        return MultiCellInfoParser.fromBuffer(buffer)
    } catch (error) {
        throw new Error(`Failed to activate info: ${error}`)
    }
}