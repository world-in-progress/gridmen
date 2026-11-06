import type { DisplayGeometryConfig, DisplayGeometryTask, DisplayGeometryEngine, PreparedDisplayChunk } from '../grid/displayGeometryEngine'
import type { DisplayChunk } from '../grid/displayTypes'

type Result = ReturnType<DisplayGeometryEngine['run']>

/** Dedicated projection worker: one active RPC, no pending camera/job queue. A
 * cancellation terminates its computation and all source-bound cached geometry.
 */
export class DisplayGeometryClient {
    private worker?: Worker
    private sequence = 0
    private pending?: { id: number; resolve: (value: Result) => void; reject: (error: Error) => void; chunks: DisplayChunk[]; prepared: PreparedDisplayChunk[]; input?: DisplayChunk[]; next: number }

    constructor(private readonly config: DisplayGeometryConfig) {}

    run(task: DisplayGeometryTask): Promise<Result> {
        if (this.pending) throw new Error('Concurrent display geometry task')
        let config: DisplayGeometryConfig | undefined
        if (!this.worker) {
            this.worker = new Worker(new URL('./displayGeometry.worker.ts', import.meta.url), { type: 'module' })
            config = this.config
            this.worker.onmessage = (event: MessageEvent<{ id: number; result: Result; part?: Result; done?: boolean; error?: string }>) => {
                if (event.data.id !== this.pending?.id) return
                const pending = this.pending
                if (event.data.part) {
                    if (event.data.part.chunks) pending.chunks.push(...event.data.part.chunks)
                    if (event.data.part.prepared) pending.prepared.push(...event.data.part.prepared)
                    return
                }
                if (event.data.done && pending.input && pending.next < pending.input.length) {
                    // The next block is cloned in this message event, after the
                    // previous block finished. Both directions stay bounded by
                    // one block; the single RPC owns just this viewport's list.
                    try {
                        this.worker!.postMessage({ id: pending.id, task: { type: 'prepare', chunks: [pending.input[pending.next++]] } })
                    } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))) }
                    return
                }
                this.pending = undefined
                if (event.data.error !== undefined) pending.reject(new Error(event.data.error))
                else if (event.data.done) pending.resolve({ chunks: pending.chunks, prepared: pending.prepared })
                else pending.resolve(event.data.result)
            }
            this.worker.onerror = event => this.fail(new Error(event.message))
            this.worker.onmessageerror = () => this.fail(new Error('Invalid display geometry message'))
        }
        return new Promise((resolve, reject) => {
            const id = ++this.sequence
            const input = task.type === 'prepare' ? task.chunks : undefined
            this.pending = { id, resolve, reject, chunks: [], prepared: [], input, next: input?.length ? 1 : 0 }
            try {
                const first = input?.length ? { type: 'prepare' as const, chunks: [input[0]] } : task
                this.worker!.postMessage({ id, config, task: first }, task.type === 'decode' ? task.blocks.map(block => block.buffer) : [])
            } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))) }
        })
    }

    dispose(): void { this.fail(new DOMException('Display geometry cancelled', 'AbortError')) }

    private fail(error: Error): void {
        this.worker?.terminate()
        this.worker = undefined
        const pending = this.pending
        this.pending = undefined
        pending?.reject(error)
    }
}
