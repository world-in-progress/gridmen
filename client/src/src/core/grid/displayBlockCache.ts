import type { DisplayBlock, DisplayBlockDecoder, DisplayChunk, DecodedDisplayBlock, GridDisplayView } from './displayTypes'
import type { PreparedDisplayChunk } from './displayGeometryEngine'
import { blockKey } from './displayHierarchy'

interface CachedDisplayChunk { chunk: DisplayChunk; prepared?: PreparedDisplayChunk }
interface CachedDisplayBlock { chunks: DisplayChunk[] }
type Footprint = Map<string, CachedDisplayBlock | undefined>

/** One source's chunks and prepared geometry follow candidate, published and
 * two stopped views. References preserve published geometry during edits.
 */
export class DisplayViewCache {
    private readonly chunks = new Map<DisplayChunk, CachedDisplayChunk>()
    private readonly currentChunks = new Map<string, DisplayChunk>()
    private readonly blocks = new Map<string, CachedDisplayBlock>()
    private readonly nodeBlocks = new Map<string, Set<string>>()
    private candidate: Footprint = new Map()
    private published: Footprint = new Map()
    private settled: Footprint[] = []

    begin(keys: string[]): void {
        this.candidate = new Map(keys.map(key => [key, this.blocks.get(key)]))
        this.prune()
    }

    getBlock(key: string): DisplayChunk[] | undefined { return this.blocks.get(key)?.chunks }

    setBlock(key: string, chunks: DisplayChunk[], prepared?: (PreparedDisplayChunk | undefined)[]): DisplayChunk[] {
        const canonical = chunks.map((chunk, index) => {
            const old = this.currentChunks.get(chunk.key)
            if (old && (old === chunk || chunk.key.startsWith('original:'))) {
                this.chunks.get(old)!.prepared ??= prepared?.[index]
                return old
            }
            this.currentChunks.set(chunk.key, chunk)
            this.chunks.set(chunk, { chunk, prepared: prepared?.[index] })
            return chunk
        })
        const group = { chunks: canonical }
        this.blocks.set(key, group)
        this.candidate.set(key, group)
        const node = key.split(':').slice(0, 3).join(':')
        const keys = this.nodeBlocks.get(node) ?? new Set<string>()
        keys.add(key)
        this.nodeBlocks.set(node, keys)
        return canonical
    }

    getPrepared(chunk: DisplayChunk): PreparedDisplayChunk | undefined { return this.chunks.get(chunk)?.prepared }

    setPrepared(chunk: DisplayChunk, prepared: PreparedDisplayChunk): void {
        const entry = this.chunks.get(chunk)
        if (!entry) throw new Error('Display chunk no longer belongs to the view')
        entry.prepared = prepared
    }

    refreshChunk(chunk: DisplayChunk): DisplayChunk {
        const entry = this.chunks.get(chunk)
        if (!entry) throw new Error('Display chunk no longer belongs to the view')
        const next = { ...chunk }
        this.chunks.set(next, { chunk: next, prepared: entry.prepared })
        for (const group of this.groups()) group.chunks = group.chunks.map(value => value === chunk ? next : value)
        if (this.currentChunks.get(chunk.key) === chunk) this.currentChunks.set(chunk.key, next)
        this.chunks.delete(chunk)
        return next
    }

    view(keys: string[]): GridDisplayView {
        const chunks = new Map<string, DisplayChunk>()
        for (const key of keys) {
            const block = this.getBlock(key)
            if (!block) throw new Error('Missing grid display block')
            for (const chunk of block) if (chunk.cells.length || chunk.fields.length) chunks.set(chunk.key, chunk)
        }
        this.prune()
        return { chunks: [...chunks.values()] }
    }

    retain(keys: string[], stopped: boolean): void {
        this.published = new Map(keys.map(key => [key, this.blocks.get(key)]))
        if (stopped) this.settled = [this.published, ...this.settled.filter(old => old.size !== this.published.size
            || [...old].some(([key, value]) => this.published.get(key) !== value))].slice(0, 2)
        this.prune()
    }

    deleteBlock(key: string): void {
        this.blocks.delete(key)
        if (this.candidate.has(key)) this.candidate.set(key, undefined)
        const node = key.split(':').slice(0, 3).join(':')
        const keys = this.nodeBlocks.get(node)
        keys?.delete(key)
        if (!keys?.size) this.nodeBlocks.delete(node)
    }

    deleteNode(key: string): void {
        for (const block of this.nodeBlocks.get(key) ?? []) this.deleteBlock(block)
    }

    deleteChunk(key: string): void {
        const chunk = this.currentChunks.get(key)
        if (!chunk) return
        this.currentChunks.delete(key)
        for (const [block, group] of this.blocks) if (group.chunks.includes(chunk)) this.deleteBlock(block)
    }

    private groups(): Set<CachedDisplayBlock> {
        const groups = new Set<CachedDisplayBlock>()
        for (const footprint of [this.candidate, this.published, ...this.settled]) {
            for (const group of footprint.values()) if (group) groups.add(group)
        }
        return groups
    }

    private prune(): void {
        const groups = this.groups(), live = new Set<DisplayChunk>()
        for (const [key, group] of this.blocks) if (!groups.has(group)) this.deleteBlock(key)
        for (const group of groups) for (const chunk of group.chunks) live.add(chunk)
        for (const chunk of this.chunks.keys()) if (!live.has(chunk)) {
            this.chunks.delete(chunk)
            if (this.currentChunks.get(chunk.key) === chunk) this.currentChunks.delete(chunk.key)
        }
    }

    clear(): void {
        this.chunks.clear(); this.currentChunks.clear(); this.blocks.clear(); this.nodeBlocks.clear()
        this.candidate.clear(); this.published.clear(); this.settled = []
    }
}

/** Immutable HTTP responses share the same retention owner as their geometry. */
export class DisplayBlockCache extends DisplayViewCache {
    private epoch = 0

    constructor(private readonly load: (blocks: DisplayBlock[], signal: AbortSignal, decode: DisplayBlockDecoder) => Promise<DecodedDisplayBlock[]>) { super() }

    async query(blocks: DisplayBlock[], signal: AbortSignal, decode: DisplayBlockDecoder): Promise<GridDisplayView> {
        const epoch = this.epoch
        signal.throwIfAborted()
        const keys = blocks.map(blockKey)
        this.begin(keys)
        const missing = blocks.filter(block => !this.getBlock(blockKey(block)))
        const loaded = missing.length ? await this.load(missing, signal, decode) : []
        signal.throwIfAborted()
        if (epoch !== this.epoch) throw new DOMException('Grid source cache cancelled', 'AbortError')
        loaded.forEach((result, index) => this.setBlock(blockKey(missing[index]), result.chunks, result.prepared))
        return this.view(keys)
    }

    override clear(): void { this.epoch++; super.clear() }
}
