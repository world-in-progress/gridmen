import type { DisplayBlock, DisplayChunk, GridDisplayMeta, GridDisplayView } from './displayTypes'
import { blockKey, displayLayer, nodeBounds } from './displayHierarchy'

const HEADER_BYTES = 8
const RECORD_BYTES = 72

/** Decode and validate once, at the HTTP boundary. All geometry/attributes stay float64. */
export function decodeDisplayBlock(buffer: ArrayBuffer, block: DisplayBlock, meta: GridDisplayMeta): DisplayChunk {
    if (buffer.byteLength < HEADER_BYTES) throw new Error('Truncated grid display header')
    const data = new DataView(buffer)
    if (data.getUint32(0, false) !== 0x47444e34) throw new Error('Invalid grid display format')
    const count = data.getUint32(4, true)
    if (buffer.byteLength !== HEADER_BYTES + RECORD_BYTES * count) throw new Error('Invalid grid display record count')
    const chunk: DisplayChunk = { key: blockKey(block), bounds: nodeBounds(displayLayer(meta.displayLayers, block.blockLayer), block.x, block.y, meta.alignment_origin), cells: [], fields: [] }
    const ids = new Set<number>()
    for (let i = 0; i < count; i++) {
        const offset = HEADER_BYTES + i * RECORD_BYTES
        const rawId = data.getBigUint64(offset, true)
        if (rawId > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Grid cell ID exceeds the exact integer range')
        const id = Number(rawId)
        const bounds: [number, number, number, number] = [0, 1, 2, 3].map(k => data.getFloat64(offset + 8 + k * 8, true)) as [number, number, number, number]
        const occupiedArea = data.getFloat64(offset + 40, true)
        const elevationArea = data.getFloat64(offset + 48, true)
        const minCellSize = data.getFloat64(offset + 56, true)
        const level = data.getUint32(offset + 64, true), landClass = data.getUint32(offset + 68, true)
        const area = (bounds[2] - bounds[0]) * (bounds[3] - bounds[1])
        if (!bounds.every(Number.isFinite) || !(bounds[2] > bounds[0] && bounds[3] > bounds[1])
            || !(occupiedArea > 0 && Number.isFinite(occupiedArea)) || occupiedArea > area * (1 + 1e-10)
            || !Number.isFinite(elevationArea) || !(minCellSize > 0 && Number.isFinite(minCellSize))
            || level < 1 || level > meta.grid_info.length || landClass > 255 || (id && ids.has(id))) throw new Error('Invalid grid display node')
        const sample = { bounds, level, elevation: elevationArea / occupiedArea, landClass }
        if (!Number.isFinite(sample.elevation)) throw new Error('Invalid grid display elevation')
        if (id) { ids.add(id); chunk.cells.push({ ...sample, id }) }
        else chunk.fields.push({ ...sample, occupiedFraction: Math.min(1, occupiedArea / area), minCellSize })
    }
    return chunk
}

/** An original cell spanning several requested blocks owns one draw instance. */
export function displayBlockView(chunks: DisplayChunk[], cellCount: number): GridDisplayView {
    const originals = new Map<number, DisplayChunk>()
    const result: DisplayChunk[] = []
    const counts = new Map<number, number>()
    for (const chunk of chunks) for (const cell of chunk.cells) counts.set(cell.id, (counts.get(cell.id) ?? 0) + 1)
    for (const chunk of chunks) {
        const inside = chunk.cells.filter(cell => {
            const a = cell.bounds, b = chunk.bounds
            if (counts.get(cell.id)! > 1 || a[0] <= b[0] && a[1] <= b[1] && a[2] >= b[2] && a[3] >= b[3]) {
                if (!originals.has(cell.id)) originals.set(cell.id, { key: `original:${cell.id}`, bounds: a, cells: [cell], fields: [] })
                return false
            }
            return true
        })
        if (inside.length || chunk.fields.length) result.push(inside.length === chunk.cells.length ? chunk : { ...chunk, cells: inside })
    }
    result.push(...originals.values())
    return { chunks: result, cellCount }
}
