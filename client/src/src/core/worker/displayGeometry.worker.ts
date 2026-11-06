import { DisplayGeometryEngine, type DisplayGeometryConfig, type DisplayGeometryTask } from '../grid/displayGeometryEngine'

let engine: DisplayGeometryEngine
self.onmessage = (event: MessageEvent<{ id: number; config?: DisplayGeometryConfig; task: DisplayGeometryTask }>) => {
    const { id, config, task } = event.data
    try {
        if (config) engine = new DisplayGeometryEngine(config)
        // Keep structured-clone work on the receiving thread to one grid block
        // per message. A full mixed viewport can contain hundreds of thousands
        // of exact samples; one enormous reply would itself stall interaction.
        // This is one RPC's finite output, not a queue of camera requests.
        if (task.type === 'decode' || task.type === 'prepare') {
            const count = task.type === 'decode' ? task.blocks.length : task.chunks.length
            for (let i = 0; i < count; i++) {
                const part = engine.run(task.type === 'decode' ? { ...task, blocks: [task.blocks[i]] } : { ...task, chunks: [task.chunks[i]] })
                self.postMessage({ id, part }, part.prepared!.map(chunk => chunk.data.buffer))
            }
            self.postMessage({ id, done: true })
            return
        }
        const result = engine.run(task)
        self.postMessage({ id, result }, result.prepared?.map(chunk => chunk.data.buffer) ?? [])
    } catch (error) {
        self.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
    }
}
