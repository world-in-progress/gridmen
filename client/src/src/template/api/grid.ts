import { decodeNodeInfo } from './utils'
import type { DisplayBlock, DisplayBlockDecoder, GridDisplayMeta, GridDisplayView, GridInspection } from '@/core/grid/displayTypes'
import type { BaseResponse } from './types'
import { decodeDisplayBlock, displayBlockView } from '@/core/grid/displayWire'
import { gridDisplayI18n } from '@/i18n/gridDisplay'
import { DisplayBlockCache } from '@/core/grid/displayBlockCache'

const API_PREFIX = `/api/grid`
async function requestGridDisplay(nodeInfo: string, path: string, options?: RequestInit): Promise<Response> {
    const { address, nodeKey } = decodeNodeInfo(nodeInfo)
    const response = await fetch(`${address}${API_PREFIX}/${encodeURIComponent(nodeKey)}/display/${path}`, options)
    if (!response.ok) {
        const detail = await response.text()
        throw new Error(gridDisplayI18n.t('httpError', { path, status: response.status, detail: detail ? ` — ${detail}` : '' }))
    }
    return response
}

export const getGridDisplayMeta = async (nodeInfo: string, signal?: AbortSignal): Promise<GridDisplayMeta> =>
    (await requestGridDisplay(nodeInfo, 'meta', { signal })).json()

async function loadGridDisplayChunks(nodeInfo: string, meta: GridDisplayMeta, blocks: DisplayBlock[], signal?: AbortSignal, decode?: DisplayBlockDecoder) {
    const responses = await Promise.all(blocks.map(async block => {
        const path = `nodes/${encodeURIComponent(meta.revision)}/${block.blockLayer}/${block.x}/${block.y}/${block.displayLayer}`
        const response = await requestGridDisplay(nodeInfo, path, { signal })
        return { block, buffer: await response.arrayBuffer() }
    }))
    signal?.throwIfAborted()
    return decode ? decode(responses) : responses.map(({ buffer, block }) => decodeDisplayBlock(buffer, block, meta))
}

export function createGridDisplayBlockCache(nodeInfo: string, meta: GridDisplayMeta): DisplayBlockCache {
    // The closure owns source URL, immutable revision, CRS, and lattice identity.
    return new DisplayBlockCache(meta, (blocks, signal, decode) => loadGridDisplayChunks(nodeInfo, meta, blocks, signal, decode))
}

export async function queryGridDisplayBlocks(nodeInfo: string, meta: GridDisplayMeta, blocks: DisplayBlock[], signal?: AbortSignal): Promise<GridDisplayView> {
    return displayBlockView(await loadGridDisplayChunks(nodeInfo, meta, blocks, signal), meta.cellCount)
}

export const inspectGrid = async (nodeInfo: string, x: number, y: number, signal?: AbortSignal): Promise<GridInspection> =>
    (await requestGridDisplay(nodeInfo, `inspect?${new URLSearchParams({ x: String(x), y: String(y) })}`, { signal })).json()

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
