import type { DisplayBlock, DisplayChunk, GridDisplayMeta } from './displayTypes'
import { blockKey, displayLayer, nodeBounds } from './displayHierarchy'

const HEADER_BYTES = 4
const RECORD_BYTES = 72

declare const validatedDisplayBlock: unique symbol
/** Only a decode worker's successful reply may carry this internal capability. */
export type ValidatedDisplayBlockBuffer = ArrayBuffer & { readonly [validatedDisplayBlock]: true }

/** Decode and validate once, at the HTTP boundary. All geometry/attributes stay float64. */
export function decodeDisplayBlock(buffer: ArrayBuffer, block: DisplayBlock, meta: GridDisplayMeta): DisplayChunk {
    return readDisplayBlock(buffer, block, meta, true)
}

/** Restore one acknowledged block from the worker, which already validated and
 * prepared these exact transferred bytes. Never use for network input.
 */
export function restoreDisplayBlock(buffer: ValidatedDisplayBlockBuffer, block: DisplayBlock, meta: GridDisplayMeta): DisplayChunk {
    return readDisplayBlock(buffer, block, meta, false)
}

function readDisplayBlock(buffer: ArrayBuffer, block: DisplayBlock, meta: GridDisplayMeta, validate: boolean): DisplayChunk {
    if (validate && buffer.byteLength < HEADER_BYTES) throw new Error('Truncated grid display header')
    const data = new DataView(buffer)
    if (validate && data.getUint32(0, false) !== 0x47444e35) throw new Error('Invalid grid display format')
    if (validate && (buffer.byteLength - HEADER_BYTES) % RECORD_BYTES !== 0) throw new Error('Invalid grid display record length')
    const count = (buffer.byteLength - HEADER_BYTES) / RECORD_BYTES
    const chunk: DisplayChunk = { key: blockKey(block), bounds: nodeBounds(displayLayer(meta.displayLayers, block.blockLayer), block.x, block.y, meta.alignment_origin), cells: [], fields: [] }
    const ids = validate ? new Set<number>() : undefined
    for (let i = 0; i < count; i++) {
        const offset = HEADER_BYTES + i * RECORD_BYTES
        const rawId = data.getBigUint64(offset, true)
        if (validate && rawId > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Grid cell ID exceeds the exact integer range')
        const id = Number(rawId)
        const bounds: [number, number, number, number] = [0, 1, 2, 3].map(k => data.getFloat64(offset + 8 + k * 8, true)) as [number, number, number, number]
        const occupiedArea = data.getFloat64(offset + 40, true)
        const elevationArea = data.getFloat64(offset + 48, true)
        const minCellSize = data.getFloat64(offset + 56, true)
        const level = data.getUint32(offset + 64, true), landClass = data.getUint32(offset + 68, true)
        const area = (bounds[2] - bounds[0]) * (bounds[3] - bounds[1])
        if (validate && (!bounds.every(Number.isFinite) || !(bounds[2] > bounds[0] && bounds[3] > bounds[1])
            || !(occupiedArea > 0 && Number.isFinite(occupiedArea)) || occupiedArea > area * (1 + 1e-10)
            || !Number.isFinite(elevationArea) || !(minCellSize > 0 && Number.isFinite(minCellSize))
            || level < 1 || level > meta.grid_info.length || landClass > 255 || (id && ids!.has(id)))) throw new Error('Invalid grid display node')
        const sample = { bounds, level, elevation: elevationArea / occupiedArea, landClass }
        if (validate && !Number.isFinite(sample.elevation)) throw new Error('Invalid grid display elevation')
        if (id) { ids?.add(id); chunk.cells.push({ ...sample, id }) }
        else chunk.fields.push({ ...sample, occupiedFraction: Math.min(1, occupiedArea / area), minCellSize })
    }
    return chunk
}

/** Split before geometry preparation. A crossing original keeps its own bounds
 * and is prepared once under a stable ID, independent of the block first seen.
 */
export function canonicalDisplayChunks(chunk: DisplayChunk): DisplayChunk[] {
    const originals: DisplayChunk[] = []
    const inside = chunk.cells.filter(cell => {
        const a = cell.bounds, b = chunk.bounds
        if (a[0] < b[0] || a[1] < b[1] || a[2] > b[2] || a[3] > b[3]
            || a[0] <= b[0] && a[1] <= b[1] && a[2] >= b[2] && a[3] >= b[3]) {
            originals.push({ key: `original:${cell.id}`, bounds: a, cells: [cell], fields: [] })
            return false
        }
        return true
    })
    const result: DisplayChunk[] = []
    if (inside.length || chunk.fields.length) result.push(inside.length === chunk.cells.length ? chunk : { ...chunk, cells: inside })
    result.push(...originals)
    return result
}
