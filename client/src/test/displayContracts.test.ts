import assert from 'node:assert/strict'
import test from 'node:test'
import { elevationColor, ELEVATION_LOW_COLOR, ELEVATION_HIGH_COLOR, OUTLINE_DARKENING } from '../src/core/grid/displayColors'
import { validateDisplayMeta, validateDisplayView } from '../src/core/grid/displayValidation'
import { chunkMatrix, polygonIntersectsBox } from '../src/views/mapView/topology/displayProjection'
import type { GridDisplayMeta, GridDisplayView } from '../src/core/grid/displayTypes'

test('shared elevation colors clamp values, interpolate, and handle constant ranges', () => {
    assert.deepEqual(elevationColor(-10, [0, 100]), ELEVATION_LOW_COLOR)
    assert.deepEqual(elevationColor(150, [0, 100]), ELEVATION_HIGH_COLOR)
    assert.deepEqual(elevationColor(99, [10, 10]), ELEVATION_LOW_COLOR)
    const middle = elevationColor(50, [0, 100])
    middle.forEach((value, index) => assert.ok(Math.abs(value - (ELEVATION_LOW_COLOR[index] + ELEVATION_HIGH_COLOR[index]) / 2) < 1e-12))
    assert.equal(OUTLINE_DARKENING, 0.65)
})

test('source boundary rejects corrupt occupancy and metadata before GPU allocation', () => {
    const meta: GridDisplayMeta = { epsg: 3857, bounds: [0, 0, 2, 2], grid_info: [[1, 1]], level_info: [{ width: 2, height: 2 }], subdivide_rules: [], alignment_origin: [0, 0], cellCount: 2, attributes: ['level'], elevationRange: [0, 0], landClasses: [1, 3] }
    validateDisplayMeta(meta)
    assert.throws(() => validateDisplayMeta({ ...meta, landClasses: [3, 1] }))
    assert.throws(() => validateDisplayMeta({ ...meta, bounds: [0, 0, Infinity, 1] }))
    const view: GridDisplayView = { cellCount: 2, chunks: [{ key: 'field', bounds: [0, 0, 1, 1], cells: [], fields: [{ bounds: [0, 0, 1, 1], occupiedFraction: 0.5, minCellSize: 0.1, level: 1, elevation: 0, landClass: 1 }] }] }
    validateDisplayView(view)
    for (const occupiedFraction of [0, -1, 1.1, NaN]) {
        assert.throws(() => validateDisplayView({ ...view, chunks: [{ ...view.chunks[0], fields: [{ ...view.chunks[0].fields[0], occupiedFraction }] }] }))
    }
    assert.throws(() => validateDisplayView({ ...view, chunks: [...view.chunks, ...view.chunks] }))
})

test('rotated box selection rejects cells whose projected bounding boxes only overlap', () => {
    const diamond: [number, number][] = [[0, 1], [1, 0], [2, 1], [1, 2]]
    assert.equal(polygonIntersectsBox(diamond, [1.7, 1.7, 1.9, 1.9]), false)
    assert.equal(polygonIntersectsBox(diamond, [0.9, 0.9, 1.1, 1.1]), true)
    assert.equal(polygonIntersectsBox(diamond, [2, 0, 3, 1]), false)
})

test('chunk origin cancels large zoom translation before float conversion', () => {
    const zoom = 2 ** 30
    const origin: [number, number] = [0.500000001, 0.499999999]
    const matrix = [zoom, 0, 0, 0, 0, zoom, 0, 0, 0, 0, 1, 0, -zoom * origin[0] + 0.25, -zoom * origin[1] - 0.75, 0, 1]
    const relative = chunkMatrix(matrix, origin)
    assert.equal(relative[12], 0.25)
    assert.equal(relative[13], -0.75)
})
