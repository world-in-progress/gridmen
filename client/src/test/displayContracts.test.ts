import assert from 'node:assert/strict'
import test from 'node:test'
import { elevationColor, ELEVATION_LOW_COLOR, ELEVATION_HIGH_COLOR, OUTLINE_DARKENING } from '../src/core/grid/displayColors'
import { validateDisplayMeta, validateDisplayView } from '../src/core/grid/displayValidation'
import { displayLayers } from '../src/core/grid/displayHierarchy'
import { chunkMatrix, displayCamera } from '../src/views/mapView/topology/displayProjection'
import proj4 from 'proj4'
import { MercatorCoordinate } from '../src/core/math/mercatorCoordinate'
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
    const meta: GridDisplayMeta = { revision: 'r1', displayLayers: displayLayers([0, 0, 2, 2], [[1, 1]], [0, 0]),
        epsg: 3857, bounds: [0, 0, 2, 2], grid_info: [[1, 1]], level_info: [{ width: 2, height: 2 }], subdivide_rules: [], alignment_origin: [0, 0], cellCount: 2, attributes: ['level'], elevationRange: [0, 0], landClasses: [1, 3] }
    validateDisplayMeta(meta)
    assert.throws(() => validateDisplayMeta({ ...meta, revision: '' }))
    assert.throws(() => validateDisplayMeta({ ...meta, displayLayers: [] }))
    assert.throws(() => validateDisplayMeta({ ...meta, landClasses: [3, 1] }))
    assert.throws(() => validateDisplayMeta({ ...meta, bounds: [0, 0, Infinity, 1] }))
    const view: GridDisplayView = { cellCount: 2, chunks: [{ key: 'field', bounds: [0, 0, 1, 1], cells: [], fields: [{ bounds: [0, 0, 1, 1], occupiedFraction: 0.5, minCellSize: 0.1, level: 1, elevation: 0, landClass: 1 }] }] }
    validateDisplayView(view)
    for (const occupiedFraction of [0, -1, 1.1, NaN]) {
        assert.throws(() => validateDisplayView({ ...view, chunks: [{ ...view.chunks[0], fields: [{ ...view.chunks[0].fields[0], occupiedFraction }] }] }))
    }
    assert.throws(() => validateDisplayView({ ...view, chunks: [...view.chunks, ...view.chunks] }))
})

test('chunk origin cancels large zoom translation before float conversion', () => {
    const zoom = 2 ** 30
    const origin: [number, number] = [0.500000001, 0.499999999]
    const matrix = [zoom, 0, 0, 0, 0, zoom, 0, 0, 0, 0, 1, 0, -zoom * origin[0] + 0.25, -zoom * origin[1] - 0.75, 0, 1]
    const relative = chunkMatrix(matrix, origin)
    assert.equal(relative[12], 0.25)
    assert.equal(relative[13], -0.75)
})

test('Mercator invariants apply only to the public flat camera and the completed globe transition', () => {
    let zoom = 10, pitch = 0, bearing = 0, name = 'mercator'
    const map = {
        getCanvas: () => ({ clientWidth: 100, clientHeight: 100 }),
        getProjection: () => ({ name }), getZoom: () => zoom, getPitch: () => pitch, getBearing: () => bearing,
        unproject: ([x, y]: [number, number]) => ({ lng: x * 0.01, lat: MercatorCoordinate.latFromMercatorY(0.5 + y / 36000) }),
    }
    const projection = proj4('EPSG:4326', 'EPSG:4326')
    assert.ok(displayCamera(map as never, projection).mercator)
    for (const [p, b] of [[1, 0], [0, 90]]) {
        pitch = p; bearing = b
        assert.equal(displayCamera(map as never, projection).mercator, undefined)
    }
    pitch = 0; bearing = 0; name = 'globe'; zoom = 5.999
    assert.equal(displayCamera(map as never, projection).mercator, undefined)
    zoom = 6
    assert.ok(displayCamera(map as never, projection).mercator)
})
