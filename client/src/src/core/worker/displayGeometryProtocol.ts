import type { DisplayGeometryEngine, PreparedDisplayChunk } from '../grid/displayGeometryEngine'
import type { ValidatedDisplayBlockBuffer } from '../grid/displayWire'

export type DisplayGeometryResult = ReturnType<DisplayGeometryEngine['run']>

/** Decode returns the validated input buffer, never the engine's chunk graph.
 * The client restores that one block before acknowledging the next input.
 */
export interface DisplayGeometryReply {
    id: number
    result?: DisplayGeometryResult
    part?: { prepared?: PreparedDisplayChunk[] }
    decoded?: ValidatedDisplayBlockBuffer
    done?: boolean
    error?: string
}
