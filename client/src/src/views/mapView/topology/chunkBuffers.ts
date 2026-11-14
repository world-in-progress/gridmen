import type { DisplayChunk } from '../../../core/grid/displayTypes'
import { cellSide } from '../../../core/grid/displayMath'

/** One 16-float record per drawn cell or field sample. Field flags.xy hold native sample width/height; real-cell flags.xy are zero/deleted. */
const FLOATS_PER_INSTANCE = 16
const STRIDE = FLOATS_PER_INSTANCE * Float32Array.BYTES_PER_ELEMENT

export interface ChunkBuffer {
    buffer: WebGLBuffer
    vao: WebGLVertexArrayObject
    origin: [number, number]
    count: number
    minOriginalCellSize: number
    source: DisplayChunk
}

export class ChunkBuffers {
    readonly chunks = new Map<string, ChunkBuffer>()

    constructor(private readonly gl: WebGL2RenderingContext) {}

    sync(
        visible: DisplayChunk[],
        prepare: (chunk: DisplayChunk) => { data: Float32Array; origin: [number, number] },
    ): void {
        const keys = new Set(visible.map(chunk => chunk.key))
        for (const key of this.chunks.keys()) {
            if (!keys.has(key)) this.remove(key)
        }

        for (const chunk of visible) {
            const old = this.chunks.get(chunk.key)
            if (old?.source === chunk) continue

            // Drop the old resource first so a failed preparation cannot draw stale data.
            this.remove(chunk.key)
            const { data, origin } = prepare(chunk)
            if (data.length % FLOATS_PER_INSTANCE !== 0) {
                throw new Error(`Chunk ${chunk.key} has an incomplete instance record`)
            }
            const resource = this.upload(chunk, data, origin)
            this.chunks.set(chunk.key, resource)
        }
    }

    clear(): void {
        for (const key of this.chunks.keys()) this.remove(key)
    }

    private remove(key: string): void {
        const resource = this.chunks.get(key)
        if (!resource) return
        this.gl.deleteVertexArray(resource.vao)
        this.gl.deleteBuffer(resource.buffer)
        this.chunks.delete(key)
    }

    private upload(
        source: DisplayChunk,
        data: Float32Array,
        origin: [number, number],
    ): ChunkBuffer {
        const gl = this.gl
        const buffer = gl.createBuffer()
        if (!buffer) throw new Error(`Failed to create buffer for chunk ${source.key}`)
        const vao = gl.createVertexArray()
        if (!vao) {
            gl.deleteBuffer(buffer)
            throw new Error(`Failed to create vertex array for chunk ${source.key}`)
        }

        try {
            gl.bindVertexArray(vao)
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
            gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
            const error = gl.getError()
            if (error !== gl.NO_ERROR) {
                throw new Error(`WebGL error ${error} uploading chunk ${source.key}`)
            }
            const widths = [2, 2, 2, 2, 4, 4]
            const offsets = [0, 8, 16, 24, 32, 48]
            for (let location = 0; location < widths.length; location++) {
                gl.enableVertexAttribArray(location)
                gl.vertexAttribPointer(location, widths[location], gl.FLOAT, false, STRIDE, offsets[location])
                gl.vertexAttribDivisor(location, 1)
            }
        } catch (error) {
            gl.deleteVertexArray(vao)
            gl.deleteBuffer(buffer)
            throw error
        } finally {
            gl.bindVertexArray(null)
            gl.bindBuffer(gl.ARRAY_BUFFER, null)
        }

        return {
            buffer, vao, origin, count: data.length / FLOATS_PER_INSTANCE,
            minOriginalCellSize: source.cells.reduce((minimum, cell) => Math.min(minimum, cellSide(cell)), Infinity),
            source,
        }
    }
}
