import { decodeNodeInfo } from './utils'
import { MultiCellInfoParser } from '@/core/grid/types'
import { BaseResponse, MultiCellBaseInfo, PatchMeta } from './types'

const API_PREFIX = `/api/patch`
const UNDELETED_FLAG = 0

export const getPatchMeta = async (nodeInfo: string, lockId: string | null) => {
    const { address, nodeKey } = decodeNodeInfo(nodeInfo)
    const url = `${address}${API_PREFIX}/meta?node_key=${nodeKey}` + (lockId ? `&lock_id=${lockId}` : '')

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

export const deletedCellInfo = async (nodeInfo: string, lockId: string) => {
    const { address, nodeKey } = decodeNodeInfo(nodeInfo)
    const url = `${address}${API_PREFIX}/deleted-info?node_key=${nodeKey}&lock_id=${lockId}`

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

export const subdivideCells = async (query: MultiCellBaseInfo, nodeInfo: string, lockId: string) => {
    const { address, nodeKey } = decodeNodeInfo(nodeInfo)
    const url = `${address}${API_PREFIX}/subdivide?node_key=${nodeKey}&lock_id=${lockId}`

    try {
        const buffer = MultiCellInfoParser.toBuffer(query)
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: buffer,
        })

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`)
        }

        const resBuffer = await response.arrayBuffer()
        return MultiCellInfoParser.fromBuffer(resBuffer)

    } catch (error) {
        throw new Error(`Failed to subdivide cells: ${error}`)
    }
}

export const mergeCells = async (query: MultiCellBaseInfo, nodeInfo: string, lockId: string) => {
    const { address, nodeKey } = decodeNodeInfo(nodeInfo)
    const url = `${address}${API_PREFIX}/merge?node_key=${nodeKey}&lock_id=${lockId}`

    try {
        const buffer = MultiCellInfoParser.toBuffer(query)
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: buffer,
        })

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`)
        }

        const resBuffer = await response.arrayBuffer()
        const parentInfo = MultiCellInfoParser.fromBuffer(resBuffer)
        parentInfo.deleted = new Uint8Array(parentInfo.levels.length).fill(UNDELETED_FLAG)
        return parentInfo

    } catch (error) {
        throw new Error(`Failed to merge cells: ${error}`)
    }
}

export const deleteCells = async (query: MultiCellBaseInfo, nodeInfo: string, lockId: string) => {
    const { address, nodeKey } = decodeNodeInfo(nodeInfo)
    const url = `${address}${API_PREFIX}/delete?node_key=${nodeKey}&lock_id=${lockId}`

    try {
        const buffer = MultiCellInfoParser.toBuffer(query)
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: buffer,
        })

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`)
        }

    } catch (error) {
        throw new Error(`Failed to remove cells: ${error}`)
    }
}

export const restoreCells = async (query: MultiCellBaseInfo, nodeInfo: string, lockId: string) => {
    const { address, nodeKey } = decodeNodeInfo(nodeInfo)
    const url = `${address}${API_PREFIX}/restore?node_key=${nodeKey}&lock_id=${lockId}`

    try {
        const buffer = MultiCellInfoParser.toBuffer(query)
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: buffer,
        })

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`)
        }
    } catch (error) {
        throw new Error(`Failed to recover cells: ${error}`)
    }
}

export const pickByFeature = async (featureDir: string, nodeInfo: string, lockId: string) => {
    const { address, nodeKey } = decodeNodeInfo(nodeInfo)
    const url = `${address}${API_PREFIX}/pick`
    const body = {
        patch_token: {
            node_key: nodeKey,
            lock_id: lockId
        },
        file_or_feature_token: featureDir
    }

    try {
        const response = await fetch(
            url,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            }
        )

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`)
        }

        const buffer = await response.arrayBuffer()
        return MultiCellInfoParser.fromBuffer(buffer)

    } catch (error) {
        throw new Error(`Failed to pick cells by feature: ${error}`)
    }
}

export const pickByVectorNode = async (nodeInfo: string, lockId: string, vectorNodeInfo: string, vectorNodeLockId: string | null) => {
    const { address, nodeKey } = decodeNodeInfo(nodeInfo)
    const url = `${address}${API_PREFIX}/pick`
    const body = {
        patch_token: {
            node_key: nodeKey,
            lock_id: lockId
        },
        file_or_feature_token: {
            node_key: vectorNodeInfo,
        }
    }
    if (vectorNodeLockId) {
        (body.file_or_feature_token as any).lock_id = vectorNodeLockId
    }

    try {
        const response = await fetch(
            url,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            }
        )

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`)
        }

        const buffer = await response.arrayBuffer()
        return MultiCellInfoParser.fromBuffer(buffer)

    } catch (error) {
        throw new Error(`Failed to pick cells by feature: ${error}`)
    }
}

export const savePatch = async (nodeInfo: string, lockId: string) => {
    const { address, nodeKey } = decodeNodeInfo(nodeInfo)
    const url = `${address}${API_PREFIX}/save?node_key=${nodeKey}&lock_id=${lockId}`

    try {
        const response = await fetch(url, { method: 'GET' })
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`)
        }
        const patchInfo: BaseResponse = await response.json()
        return patchInfo

    } catch (error) {
        throw new Error(`Failed to save patch: ${error}`)
    }
}