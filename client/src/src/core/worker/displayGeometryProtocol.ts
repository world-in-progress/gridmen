import type { DisplayGeometryResult, PreparedDisplayChunk } from '../grid/displayGeometryEngine'
import type { ValidatedDisplayBlockBuffer } from '../grid/displayWire'
export type { DisplayGeometryResult } from '../grid/displayGeometryEngine'

/** Decode returns the validated input buffer, never the engine's chunk graph.
 * The client restores that one block before acknowledging the next input.
 */
export interface DisplayGeometryReply {
    id: number
    result?: DisplayGeometryResult
    part?: { prepared: (PreparedDisplayChunk | undefined)[] }
    decoded?: ValidatedDisplayBlockBuffer
    done?: boolean
    error?: string
}
