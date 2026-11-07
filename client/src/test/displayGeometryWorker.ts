import { DisplayGeometryEngine, type DisplayGeometryConfig, type DisplayGeometryTask } from '../src/core/grid/displayGeometryEngine'

/** Node lifecycle tests execute the real engine with asynchronous worker messages
 * and the same structured-clone transfer semantics as a module worker.
 */
export class GeometryWorker {
    onmessage?: (event: { data: unknown }) => void
    onerror?: (event: { message: string }) => void
    onmessageerror?: () => void
    private engine?: DisplayGeometryEngine
    private terminated = false
    private decodeId?: number
    private seenOriginals = new Set<number>()

    postMessage(message: { id: number; config?: DisplayGeometryConfig; task: DisplayGeometryTask }, transfer: Transferable[] = []): void {
        const input = structuredClone(message, { transfer })
        queueMicrotask(() => {
            if (this.terminated) return
            try {
                if (input.config) this.engine = new DisplayGeometryEngine(input.config)
                if (input.task.type === 'decode') {
                    if (this.decodeId !== input.id) {
                        this.decodeId = input.id
                        this.seenOriginals = new Set(input.task.knownOriginals)
                    }
                    const [part] = this.engine!.decodeBlocks(input.task.blocks, input.task.meta, this.seenOriginals)
                    const decoded = input.task.blocks[0]?.buffer
                    this.onmessage?.({ data: structuredClone({ id: input.id, decoded, part: { prepared: part?.prepared ?? [] }, done: true }, {
                        transfer: [...(part?.prepared.flatMap(chunk => chunk ? [chunk.data.buffer] : []) ?? []), ...(decoded ? [decoded] : [])],
                    }) })
                } else if (input.task.type === 'prepare') {
                    this.decodeId = undefined; this.seenOriginals.clear()
                    const result = this.engine!.run(input.task)
                    this.onmessage?.({ data: structuredClone({ id: input.id, part: { prepared: result.prepared }, done: true }, {
                        transfer: result.prepared?.map(chunk => chunk.data.buffer) ?? [],
                    }) })
                } else {
                    this.decodeId = undefined; this.seenOriginals.clear()
                    const result = this.engine!.run(input.task)
                    this.onmessage?.({ data: structuredClone({ id: input.id, result }) })
                }
            } catch (error) {
                this.onmessage?.({ data: { id: input.id, error: error instanceof Error ? error.message : String(error) } })
            }
        })
    }

    terminate(): void { this.terminated = true }
}
