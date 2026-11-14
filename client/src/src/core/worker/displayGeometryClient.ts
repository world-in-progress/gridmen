import type { DisplayGeometryConfig, DisplayGeometryTask, PreparedDisplayChunk } from '../grid/displayGeometryEngine'
import type { DecodedDisplayBlock } from '../grid/displayTypes'
import { canonicalDisplayChunks, restoreDisplayBlock } from '../grid/displayWire'
import type { DisplayGeometryReply, DisplayGeometryResult as Result } from './displayGeometryProtocol'

type StreamTask = Extract<DisplayGeometryTask, { type: 'prepare' | 'decode' }>

/** Dedicated projection worker: one active RPC, no pending camera/job queue. A
 * cancellation terminates its computation and all source-bound cached geometry.
 */
export class DisplayGeometryClient {
    private worker?: Worker
    private sequence = 0
    private pending?: { id: number; resolve: (value: Result) => void; reject: (error: Error) => void; decodedBlocks: DecodedDisplayBlock[]; prepared: PreparedDisplayChunk[]; input?: StreamTask; next: number; continueAfterBlock?: () => boolean }

    constructor(private readonly config: DisplayGeometryConfig) {}

    run(task: DisplayGeometryTask, continueAfterBlock?: () => boolean): Promise<Result> {
        if (this.pending) throw new Error('Concurrent display geometry task')
        let config: DisplayGeometryConfig | undefined
        if (!this.worker) {
            this.worker = new Worker(new URL('./displayGeometry.worker.ts', import.meta.url), { type: 'module' })
            config = this.config
            this.worker.onmessage = (event: MessageEvent<DisplayGeometryReply>) => {
                if (event.data.id !== this.pending?.id) return
                const pending = this.pending
                if (pending.input?.type === 'decode' && event.data.decoded) {
                    try {
                        const { block } = pending.input.blocks[pending.next - 1]
                        const chunks = canonicalDisplayChunks(restoreDisplayBlock(event.data.decoded, block, pending.input.meta))
                        const prepared = event.data.part?.prepared
                        if (!prepared || prepared.length !== chunks.length) throw new Error('Invalid decoded display geometry reply')
                        pending.decodedBlocks.push({ chunks, prepared })
                    } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); return }
                }
                if (pending.input?.type === 'prepare' && event.data.part) {
                    for (const prepared of event.data.part.prepared) {
                        if (!prepared) { this.fail(new Error('Invalid prepared display geometry reply')); return }
                        pending.prepared.push(prepared)
                    }
                    if (!event.data.done) return
                }
                if (pending.input?.type === 'decode' && event.data.part && !event.data.done) return
                if (event.data.done && pending.continueAfterBlock) {
                    try {
                        if (!pending.continueAfterBlock()) {
                            this.pending = undefined
                            pending.reject(new DOMException('Display geometry superseded', 'AbortError'))
                            return
                        }
                    } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); return }
                }
                if (event.data.done && pending.input && pending.next < (pending.input.type === 'decode' ? pending.input.blocks.length : pending.input.chunks.length)) {
                    // The receiver has finished this block before the next
                    // input is cloned or transferred under the same RPC ID.
                    try {
                        this.postNext(pending)
                    } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))) }
                    return
                }
                this.pending = undefined
                if (event.data.error !== undefined) pending.reject(new Error(event.data.error))
                else if (event.data.done) pending.resolve(pending.input?.type === 'decode'
                    ? { decodedBlocks: pending.decodedBlocks } : { prepared: pending.prepared })
                else pending.resolve(event.data.result!)
            }
            this.worker.onerror = event => this.fail(new Error(event.message))
            this.worker.onmessageerror = () => this.fail(new Error('Invalid display geometry message'))
        }
        return new Promise((resolve, reject) => {
            const id = ++this.sequence
            const input = task.type === 'prepare' || task.type === 'decode' ? task : undefined
            this.pending = { id, resolve, reject, decodedBlocks: [], prepared: [], input, next: 0, continueAfterBlock }
            try {
                if (input && (input.type === 'decode' ? input.blocks.length : input.chunks.length)) this.postNext(this.pending, config)
                else this.worker!.postMessage({ id, config, task })
            } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))) }
        })
    }

    private postNext(pending: NonNullable<DisplayGeometryClient['pending']>, config?: DisplayGeometryConfig): void {
        const input = pending.input!
        if (input.type === 'decode') {
            const block = input.blocks[pending.next++]
            this.worker!.postMessage({ id: pending.id, config, task: { type: 'decode', blocks: [block], meta: input.meta } }, [block.buffer])
        } else {
            this.worker!.postMessage({ id: pending.id, config, task: { type: 'prepare', chunks: [input.chunks[pending.next++]] } })
        }
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
