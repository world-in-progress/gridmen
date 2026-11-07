import { DisplayGeometryEngine, type DisplayGeometryConfig, type DisplayGeometryTask } from '../grid/displayGeometryEngine'
import type { ValidatedDisplayBlockBuffer } from '../grid/displayWire'
import type { DisplayGeometryReply } from './displayGeometryProtocol'

let engine: DisplayGeometryEngine
let decodeId: number | undefined
let seenOriginals = new Set<number>()
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
                if (task.type === 'decode') {
                    if (decodeId !== id) {
                        decodeId = id
                        seenOriginals = new Set(task.knownOriginals)
                    }
                    const [decoded] = engine.decodeBlocks(task.blocks, task.meta, seenOriginals)
                    const wire = task.blocks[0].buffer as ValidatedDisplayBlockBuffer
                    const transfer = decoded.prepared.flatMap(chunk => chunk ? [chunk.data.buffer] : [])
                    transfer.push(wire)
                    // GDN5 validation and preparation have completed for these
                    // exact bytes; their sample graph stays on the worker side.
                    self.postMessage({ id, decoded: wire, part: { prepared: decoded.prepared }, done: true } satisfies DisplayGeometryReply, transfer)
                } else {
                    decodeId = undefined; seenOriginals.clear()
                    const prepared = engine.run(task).prepared!
                    self.postMessage({ id, part: { prepared }, done: true } satisfies DisplayGeometryReply,
                        prepared.map(chunk => chunk.data.buffer))
                }
            } else self.postMessage({ id, done: true })
            return
        }
        decodeId = undefined; seenOriginals.clear()
        const result = engine.run(task)
        self.postMessage({ id, result }, result.prepared?.map(chunk => chunk.data.buffer) ?? [])
    } catch (error) {
        decodeId = undefined; seenOriginals.clear()
        self.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
    }
}
