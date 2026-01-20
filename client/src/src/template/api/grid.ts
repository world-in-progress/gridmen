import { decodeNodeInfo } from './utils'
import { GridBlockMetaInfo } from '@/core/grid/types'
import { BaseResponse, MultiCellBaseInfo, PatchMeta } from './types'

const API_PREFIX = `/api/grid`

export const getGridBlockMeta = async (nodeInfo: string, lockId: string) => {
    const { address, nodeKey } = decodeNodeInfo(nodeInfo)
    const url = `${address}${API_PREFIX}/block-meta?node_key=${nodeKey}&lock_id=${lockId}`

    try {
        const response = await fetch(url, { method: 'GET' })
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`)
        }
        const responseData: GridBlockMetaInfo = await response.json()
        return responseData
    } catch (error) {
        throw new Error(`Failed to get grid block meta: ${error}`)
    }
}