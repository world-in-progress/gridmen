import { decodeNodeInfo } from './utils'
import type { DisplayBlock, DisplayBlockDecoder, GridDisplayMeta, GridInspection } from '@/core/grid/displayTypes'
import type { BaseResponse } from './types'
import i18n from '@/i18n'
import { validateDisplayMeta } from '@/core/grid/displayValidation'
import { displayLayers } from '@/core/grid/displayHierarchy'
import { DisplayBlockCache } from '@/core/grid/displayBlockCache'

const API_PREFIX = `/api/grid`
const MAX_NODE_REQUESTS = 6
const pendingNodeRequests = new Set<() => void>()
let activeNodeRequests = 0

function dispatchNodeRequests(): void {
    while (activeNodeRequests < MAX_NODE_REQUESTS && pendingNodeRequests.size) {
        const start = pendingNodeRequests.values().next().value!
        pendingNodeRequests.delete(start)
        activeNodeRequests++
        start()
    }
}

export class GridDisplayHttpError extends Error {
    constructor(public readonly status: number, message: string) { super(message); this.name = 'GridDisplayHttpError' }
}
async function requestGridDisplay(nodeInfo: string, path: string, options?: RequestInit): Promise<Response> {
    const { address, nodeKey } = decodeNodeInfo(nodeInfo)
    const response = await fetch(`${address}${API_PREFIX}/${encodeURIComponent(nodeKey)}/display/${path}`, options)
    if (!response.ok) {
        const detail = await response.text()
        throw new GridDisplayHttpError(response.status, i18n.t('gridDisplay:httpError', { path, status: response.status, detail: detail ? ` — ${detail}` : '' }))
    }
    return response
}

export async function getGridDisplayMeta(nodeInfo: string, signal?: AbortSignal): Promise<GridDisplayMeta> {
    const meta: unknown = await (await requestGridDisplay(nodeInfo, 'meta', { signal })).json()
    validateDisplayMeta(meta)
    return { ...meta, displayLayers: displayLayers(meta.bounds, meta.grid_info, meta.alignment_origin, 1) }
}

async function loadGridDisplayChunks(nodeInfo: string, meta: GridDisplayMeta, blocks: DisplayBlock[], signal: AbortSignal, decode: DisplayBlockDecoder) {
    signal.throwIfAborted()
    const waiting = new Map<() => void, (reason: unknown) => void>()
    const abort = () => {
        for (const [start, reject] of waiting) {
            pendingNodeRequests.delete(start)
            reject(signal.reason)
        }
        waiting.clear()
        signal.removeEventListener('abort', abort)
    }
    const requests = blocks.map(block => new Promise<{ block: DisplayBlock; buffer: ArrayBuffer }>((resolve, reject) => {
        const start = async () => {
            waiting.delete(start)
            if (!waiting.size) signal.removeEventListener('abort', abort)
            try {
                signal.throwIfAborted()
                const path = `nodes/${encodeURIComponent(meta.revision)}/${block.blockLayer}/${block.x}/${block.y}/${block.displayLayer}`
                const response = await requestGridDisplay(nodeInfo, path, { signal })
                resolve({ block, buffer: await response.arrayBuffer() })
            } catch (error) {
                reject(error)
            } finally {
                // Keep the shared slot until fetch and body consumption settle, including on abort.
                activeNodeRequests--
                dispatchNodeRequests()
            }
        }
        waiting.set(start, reject)
        pendingNodeRequests.add(start)
    }))
    if (waiting.size) signal.addEventListener('abort', abort, { once: true })
    dispatchNodeRequests()
    const responses = await Promise.all(requests)
    signal.throwIfAborted()
    return decode(responses)
}

export function createGridDisplayBlockCache(nodeInfo: string, meta: GridDisplayMeta): DisplayBlockCache {
    // The closure owns source URL, immutable revision, CRS, and lattice identity.
    return new DisplayBlockCache((blocks, signal, decode) => loadGridDisplayChunks(nodeInfo, meta, blocks, signal, decode))
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
