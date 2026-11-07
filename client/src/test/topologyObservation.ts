import type TopologyLayer from '../src/views/mapView/topology/TopologyLayer'
import type { ChunkBuffers } from '../src/views/mapView/topology/chunkBuffers'

/** Measure the live buffer store, preserving the caller's GL binding. */
export function readChunkBuffers(gl: WebGL2RenderingContext, buffers?: ChunkBuffers) {
    const chunks = [...(buffers?.chunks.values() ?? [])]
    const previous = gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null
    let gpuBytes = 0
    try {
        for (const chunk of chunks) {
            gl.bindBuffer(gl.ARRAY_BUFFER, chunk.buffer)
            gpuBytes += gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE) as number
        }
    } finally {
        gl.bindBuffer(gl.ARRAY_BUFFER, previous)
    }
    return {
        gpuBytes,
        visibleChunks: chunks.length,
        visibleCells: chunks.reduce((sum, chunk) => sum + chunk.source.cells.length, 0),
        fieldSamples: chunks.reduce((sum, chunk) => sum + chunk.source.fields.length, 0),
    }
}

/** Install before initializing layers. WebGL exposes no texture-size query, so
 * record the actual RGB8 palette uploads and deletes in the correctness fixture. */
export function trackPaletteAllocations(gl: WebGL2RenderingContext): Map<WebGLTexture, number> {
    const allocations = new Map<WebGLTexture, number>()
    const upload = gl.texImage2D.bind(gl), remove = gl.deleteTexture.bind(gl)
    gl.texImage2D = ((...args: [number, number, number, number, number, number, number, number, ArrayBufferView | null]) => {
        if (args.length !== 9 || args[0] !== gl.TEXTURE_2D || args[2] !== gl.RGB8) {
            throw new Error('Expected a nine-argument RGB8 palette upload')
        }
        upload(...args)
        const texture = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture
        allocations.set(texture, Number(args[3]) * Number(args[4]) * 3)
    }) as typeof gl.texImage2D
    gl.deleteTexture = texture => {
        remove(texture)
        if (texture) allocations.delete(texture)
    }
    return allocations
}

/** Test-only access to renderer-owned resources. Import this helper in browser
 * fixtures instead of adding a product diagnostic API. fieldMode observes the
 * status element actually presented by the layer, and ready uses isReady. */
export function readTopologyDisplay(layer: TopologyLayer, palettes: ReadonlyMap<WebGLTexture, number>) {
    const gl = Reflect.get(layer, '_gl') as WebGL2RenderingContext
    const buffers = Reflect.get(layer, '_buffers') as ChunkBuffers | undefined
    const palette = Reflect.get(layer, '_palette') as WebGLTexture | null
    const indicator = Reflect.get(layer, '_fieldIndicator') as HTMLDivElement | null
    const chunks = readChunkBuffers(gl, buffers)
    return {
        ...chunks,
        gpuBytes: chunks.gpuBytes + (palette ? palettes.get(palette)! : 0),
        fieldMode: indicator?.style.display === 'block',
        ready: layer.isReady,
    }
}
