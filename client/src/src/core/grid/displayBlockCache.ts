import type { DisplayBlock, DisplayBlockDecoder, DisplayChunk, GridDisplayMeta, GridDisplayView } from './displayTypes'
import { blockKey } from './displayHierarchy'
import { displayBlockView } from './displayWire'

/** Immutable responses for this source/revision/lattice only. Retain the current
 * and previous viewport requests (including empty blocks), never a pan history.
 * There is deliberately no request queue, prefetch, or configurable capacity.
 */
export class DisplayBlockCache {
    private chunks = new Map<string, DisplayChunk>()
    private previous = new Set<string>()
    private view?: GridDisplayView
    private raw: DisplayChunk[] = []
    private epoch = 0

    constructor(private readonly meta: GridDisplayMeta,
        private readonly load: (blocks: DisplayBlock[], signal: AbortSignal, decode?: DisplayBlockDecoder) => Promise<DisplayChunk[]>) {}

    async query(blocks: DisplayBlock[], signal: AbortSignal, decode?: DisplayBlockDecoder): Promise<GridDisplayView> {
        const epoch = this.epoch
        signal.throwIfAborted()
        const keys = new Set(blocks.map(blockKey))
        const missing = blocks.filter(block => !this.chunks.has(blockKey(block)))
        const loaded = missing.length ? await this.load(missing, signal, decode) : []
        signal.throwIfAborted()
        if (epoch !== this.epoch) throw new DOMException('Grid source cache cancelled', 'AbortError')
        for (const chunk of loaded) this.chunks.set(chunk.key, chunk)
        const chunks = blocks.map(block => {
            const chunk = this.chunks.get(blockKey(block))
            if (!chunk) throw new Error('Missing grid display block')
            return chunk
        })
        for (const key of this.chunks.keys()) if (!keys.has(key) && !this.previous.has(key)) this.chunks.delete(key)
        this.previous = keys
        if (this.view && chunks.length === this.raw.length && chunks.every((chunk, index) => chunk === this.raw[index])) return this.view
        this.raw = chunks
        this.view = displayBlockView(chunks, this.meta.cellCount, this.view)
        return this.view
    }

    clear(): void {
        this.epoch++
        this.chunks.clear()
        this.previous.clear()
        this.view = undefined
        this.raw = []
    }
}
