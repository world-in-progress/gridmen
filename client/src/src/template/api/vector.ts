import { decodeNodeInfo } from './utils'
import { BaseResponse, UpdateVectorData, VectorDataResponse, VectorFileInfo, VectorJsonComputionResponse } from './types'

const API_PREFIX = '/api/vector'

export const saveVector = async (nodeInfo: string, lockId: string | null, featureJson: Record<string, any>) => {
    const { address, nodeKey } = decodeNodeInfo(nodeInfo)
    const url = `${address}${API_PREFIX}/save?node_key=${nodeKey}` + (lockId ? `&lock_id=${lockId}` : '')

    try {
        const requestBody = {
            feature_json: featureJson
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        })

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`)
        }

        const responseData: BaseResponse = await response.json()
        return responseData

    } catch (error) {
        throw new Error(`Failed to save vector: ${error}`)
    }
}

// export const saveUploadedVector = async (nodeInfo: string, lockId: string, fileInfo: VectorFileInfo) => {
//     const { address, nodeKey } = decodeNodeInfo(nodeInfo)
//     const url = `${address}${API_PREFIX}/save_uploaded?node_key=${nodeKey}&lock_id=${lockId}`

//     try {
//         const requestBody = {
//             node_key: nodeKey,
//             file_path: fileInfo.filePath,
//             file_type: fileInfo.fileType
//         }

//         const response = await fetch(url, {
//             method: 'POST',
//             headers: { 'Content-Type': 'application/json' },
//             body: JSON.stringify(requestBody),
//         })

//         if (!response.ok) {
//             throw new Error(`HTTP error! Status: ${response.status}`)
//         }

//         const responseData: BaseResponse = await response.json()
//         return responseData
//     } catch (error) {
//         throw new Error(`Failed to upload vector file: ${error}`)
//     }
// }


export const getVector = async (nodeInfo: string, lockId: string | null) => {
    const { address, nodeKey } = decodeNodeInfo(nodeInfo)
    const url = `${address}${API_PREFIX}/?node_key=${nodeKey}` + (lockId ? `&lock_id=${lockId}` : '')

    try {
        const response = await fetch(url, { method: 'GET' })
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`)
        }
        const responseData: VectorDataResponse = await response.json()
        return responseData
    } catch (error) {
        throw new Error(`Failed to get vector: ${error}`)
    }
}

export const updateVector = async (nodeInfo: string, lockId: string, updateData: UpdateVectorData) => {
    const { address, nodeKey } = decodeNodeInfo(nodeInfo)
    const url = `${address}${API_PREFIX}/?node_key=${nodeKey}&lock_id=${lockId}`

    try {
        const response = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateData),
        })
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`)
        }
        const responseData: BaseResponse = await response.json()
        return responseData
    } catch (error) {
        throw new Error(`Failed to update vector: ${error}`)
    }
}

// export const getVectorJsonCompution = async (nodeInfo: string, lockId: string) => {
//     const { address, nodeKey } = decodeNodeInfo(nodeInfo)
//     const url = `${address}${API_PREFIX}/feature-json-compution?node_key=${nodeKey}&lock_id=${lockId}`

//     try {
//         const response = await fetch(url, { method: 'GET' })
//         if (!response.ok) {
//             throw new Error(`HTTP error! Status: ${response.status}`)
//         }
//         const responseData: VectorJsonComputionResponse = await response.json()
//         return responseData
//     } catch (error) {
//         throw new Error(`Failed to get vector: ${error}`)
//     }
// }