import type { DisplayBlock, DisplayBlockDecoder, DisplayChunk, GridDisplayMeta, GridDisplayView } from './displayTypes'
import { blockKey } from './displayHierarchy'
import { displayBlockView } from './displayWire'

/** Immutable responses for this source/revision/lattice only. Retain two stopped
 * views plus the published and candidate requests, never a pan history.
 * There is deliberately no request queue, prefetch, or configurable capacity.
 */
export class DisplayBlockCache {
    private chunks = new Map<string, DisplayChunk>()
    private candidate = new Set<string>()
    private published = new Set<string>()
    private settled: Set<string>[] = []
    private view?: GridDisplayView
    private raw: DisplayChunk[] = []
    private epoch = 0

    constructor(private readonly meta: GridDisplayMeta,
        private readonly load: (blocks: DisplayBlock[], signal: AbortSignal, decode?: DisplayBlockDecoder) => Promise<DisplayChunk[]>) {}

    async query(blocks: DisplayBlock[], signal: AbortSignal, decode?: DisplayBlockDecoder): Promise<GridDisplayView> {
        const epoch = this.epoch
        signal.throwIfAborted()
        const keys = new Set(blocks.map(blockKey))
        this.candidate = keys
        this.prune()
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
        this.prune()
        if (this.view && chunks.length === this.raw.length && chunks.every((chunk, index) => chunk === this.raw[index])) return this.view
        this.raw = chunks
        this.view = displayBlockView(chunks, this.meta.cellCount, this.view)
        return this.view
    }

    retain(blocks: DisplayBlock[], stopped: boolean): void {
        const keys = new Set(blocks.map(blockKey))
        if ([...keys].some(key => !this.chunks.has(key))) throw new Error('Missing published grid display block')
        this.published = keys
        if (stopped) this.settled = [keys, ...this.settled.filter(old => old.size !== keys.size || [...old].some(key => !keys.has(key)))].slice(0, 2)
        this.prune()
    }

    private prune(): void {
        for (const key of this.chunks.keys()) if (!this.candidate.has(key) && !this.published.has(key) && !this.settled.some(view => view.has(key))) this.chunks.delete(key)
        if (this.raw.some(chunk => !this.chunks.has(chunk.key))) {
            this.raw = []
            this.view = undefined
        }
    }

    clear(): void {
        this.epoch++
        this.chunks.clear()
        this.candidate.clear()
        this.published.clear()
        this.settled = []
        this.view = undefined
        this.raw = []
    }
}
