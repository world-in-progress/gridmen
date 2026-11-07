import { DisplayGeometryEngine, type DisplayGeometryConfig, type DisplayGeometryTask } from '../grid/displayGeometryEngine'
import type { ValidatedDisplayBlockBuffer } from '../grid/displayWire'
import type { DisplayGeometryReply } from './displayGeometryProtocol'

let engine: DisplayGeometryEngine
self.onmessage = (event: MessageEvent<{ id: number; config?: DisplayGeometryConfig; task: DisplayGeometryTask }>) => {
    const { id, config, task } = event.data
    try {
        if (config) engine = new DisplayGeometryEngine(config)
        // Keep receiving-thread work to one grid block per message. Decode
        // transfers the validated wire instead of cloning its exact sample
        // graph; prepare continues to return only its prepared geometry.
        // This is one RPC's finite output, not a queue of camera requests.
        if (task.type === 'decode' || task.type === 'prepare') {
            const count = task.type === 'decode' ? task.blocks.length : task.chunks.length
            if (count > 1) throw new Error('Expected one display geometry block per message')
            if (count) {
                const part = engine.run(task)
                const transfer = part.prepared!.map(chunk => chunk.data.buffer)
                const reply: DisplayGeometryReply = { id, part: { prepared: part.prepared }, done: true }
                if (task.type === 'decode') {
                    // engine.run validated these exact bytes with the sole GDN4
                    // reader before preparing any geometry or granting trust.
                    reply.decoded = task.blocks[0].buffer as ValidatedDisplayBlockBuffer
                    transfer.push(reply.decoded)
                }
                self.postMessage(reply, transfer)
            } else self.postMessage({ id, done: true })
            return
        }
        const result = engine.run(task)
        self.postMessage({ id, result }, result.prepared?.map(chunk => chunk.data.buffer) ?? [])
    } catch (error) {
        self.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
    }
}
