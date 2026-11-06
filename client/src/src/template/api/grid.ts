import { decodeNodeInfo } from './utils'
import type { Bounds, GridDisplayMeta, GridDisplayView, GridInspection } from '@/core/grid/displayTypes'
import type { BaseResponse } from './types'
import { gridDisplayI18n } from '@/i18n/gridDisplay'

const API_PREFIX = `/api/grid`
async function requestGridDisplay<T>(nodeInfo: string, path: string, options?: RequestInit): Promise<T> {
    const { address, nodeKey } = decodeNodeInfo(nodeInfo)
    const response = await fetch(`${address}${API_PREFIX}/${encodeURIComponent(nodeKey)}/display/${path}`, options)
    if (!response.ok) {
        const detail = await response.text()
        throw new Error(gridDisplayI18n.t('httpError', { path, status: response.status, detail: detail ? ` — ${detail}` : '' }))
    }
    return response.json()
}

export const getGridDisplayMeta = (nodeInfo: string, signal?: AbortSignal): Promise<GridDisplayMeta> =>
    requestGridDisplay(nodeInfo, 'meta', { signal })

export const queryGridDisplay = (nodeInfo: string, bounds: Bounds, metersPerPixel: number, signal?: AbortSignal): Promise<GridDisplayView> =>
    requestGridDisplay(nodeInfo, 'query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bounds, metersPerPixel }),
        signal,
    })

export const inspectGrid = (nodeInfo: string, x: number, y: number, signal?: AbortSignal): Promise<GridInspection> =>
    requestGridDisplay(nodeInfo, `inspect?${new URLSearchParams({ x: String(x), y: String(y) })}`, { signal })

export const exportGridTopo = async (nodeInfo: string, targetPath: string): Promise<BaseResponse> => {
    const { address, nodeKey } = decodeNodeInfo(nodeInfo)
    const response = await fetch(`${address}${API_PREFIX}/export`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            node_key: nodeKey,
            target_path: targetPath
        })
    })

    return response.json()
}
