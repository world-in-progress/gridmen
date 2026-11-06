import { DisplayGeometryEngine, type DisplayGeometryConfig, type DisplayGeometryTask } from '../src/core/grid/displayGeometryEngine'

/** Node lifecycle tests execute the real engine with asynchronous worker messages.
 * The browser fixture separately exercises a real module worker and transfers.
 */
export class GeometryWorker {
    onmessage?: (event: { data: unknown }) => void
    onerror?: (event: { message: string }) => void
    onmessageerror?: () => void
    private engine?: DisplayGeometryEngine
    private terminated = false

    postMessage(message: { id: number; config?: DisplayGeometryConfig; task: DisplayGeometryTask }): void {
        const input = structuredClone(message)
        queueMicrotask(() => {
            if (this.terminated) return
            try {
                if (input.config) this.engine = new DisplayGeometryEngine(input.config)
                const result = this.engine!.run(input.task)
                if (input.task.type === 'prepare' || input.task.type === 'decode') {
                    this.onmessage?.({ data: structuredClone({ id: input.id, part: result }) })
                    this.onmessage?.({ data: { id: input.id, done: true } })
                } else this.onmessage?.({ data: structuredClone({ id: input.id, result }) })
            } catch (error) {
                this.onmessage?.({ data: { id: input.id, error: error instanceof Error ? error.message : String(error) } })
            }
        })
    }

    terminate(): void { this.terminated = true }
}
