import assert from 'node:assert/strict'
import test from 'node:test'
import proj4 from 'proj4'
import { DisplayGeometrySelector } from '../src/core/grid/displayGeometry'
import { DisplayGeometryEngine } from '../src/core/grid/displayGeometryEngine'
import { displayLayer, displayLayers, nodeBounds, nodeRange, projectedCorners, projectedRadius, requiredDisplayRadius, selectDisplayBlocks } from '../src/core/grid/displayHierarchy'
import type { Bounds } from '../src/core/grid/displayTypes'
import { MercatorCoordinate } from '../src/core/math/mercatorCoordinate'

test('invariant selection matches exhaustive four-corner selection through clipped tails, negative coordinates and ancestors', () => {
    const origin: [number, number] = [-0.5, 0.25]
    const bounds: Bounds = [-13.5, -12.75, 25.5, 26.25]
    const layers = displayLayers(bounds, [[13, 13], [1, 1]], origin)
    const project = ([x, y]: [number, number]): [number, number] => [x + 0.0001 * y * y, y + 0.0001 * x * x]
    const selector = new DisplayGeometrySelector(layers, origin, project)
    for (const scale of [0.001, 0.2, 0.7, 1.4, 1.5, 1.5000001, 2, 4, 0.2]) {
        for (const viewport of [bounds, [-10, -9, 10, 13] as Bounds, [-7, -2, 17, 23] as Bounds]) {
            const screen = (p: [number, number]): [number, number] => { const q = project(p); return [q[0] * scale + 0.13, q[1] * scale + 0.37] }
            const selected = selector.select(viewport, scale)
            assert.deepEqual(selected, selectDisplayBlocks(layers, origin, viewport, screen))
            for (const block of selected) {
                const layer = displayLayer(layers, block.displayLayer)
                const range = nodeRange(layer, nodeBounds(displayLayer(layers, block.blockLayer), block.x, block.y, origin), origin)
                for (let y = range[1]; y < range[3]; y++) for (let x = range[0]; x < range[2]; x++) {
                    assert.ok(projectedRadius(nodeBounds(layer, x, y, origin), screen) + 1e-9 >= 0.75)
                }
            }
        }
    }
})

test('a feasible circle short circuit still solves a skew node when its center circle is too small', () => {
    const trapezoid = ([x, y]: [number, number]): [number, number] => [x * (1 + 2 * y), 2 * y]
    const exact = projectedRadius([0, 0, 1, 1], trapezoid)
    assert.ok(exact > 0.75)
    assert.ok(projectedRadius([0, 0, 1, 1], trapezoid, 0.75) >= 0.75)
    const unit = (p: [number, number]): [number, number] => { const q = trapezoid(p); return [0.8 + q[0] * 1e-8, 0.4 + q[1] * 1e-8] }
    assert.ok(Math.abs(projectedRadius([0, 0, 1, 1], unit) * 1e8 - exact) < 1e-7)
})

test('repeat views do no raw transforms; long stopped pans retain only two completed viewport working sets', () => {
    const layers = displayLayers([0, 0, 100000, 256], [[64, 64], [1, 1]], [0, 0])
    let transforms = 0
    const selector = new DisplayGeometrySelector(layers, [0, 0], ([x, y]) => { transforms++; return [x * 1e-5, y * 1e-5] })
    const bounds: Bounds = [0, 0, 256, 128]
    selector.select(bounds, 1e5)
    selector.publish(selector.selectionId, true)
    assert.ok(transforms > 0)
    transforms = 0
    selector.select(bounds, 1e5)
    assert.equal(transforms, 0)
    const working = selector as unknown as { nodes: Map<string, unknown>; minima: Map<string, unknown> }
    for (let x = 4096; x < 65536; x += 4096) {
        selector.select([x, 0, x + 256, 128], 1e5)
        selector.publish(selector.selectionId, true)
    }
    const lastTwo = [57344, 61440].map(x => {
        const isolated = new DisplayGeometrySelector(layers, [0, 0], ([a, b]) => [a * 1e-5, b * 1e-5])
        isolated.select([x, 0, x + 256, 128], 1e5)
        const cold = isolated as unknown as typeof working
        return cold.nodes.size + cold.minima.size
    })
    assert.ok(working.nodes.size + working.minima.size <= lastTwo[0] + lastTwo[1])
    // A previously rejected finer layer must finish every node when zoom makes
    // it eligible; its first invalid sample alone can never prove acceptance.
    const zoomed = selector.select(bounds, 2e5)
    assert.deepEqual(zoomed, selectDisplayBlocks(layers, [0, 0], bounds, ([x, y]) => [x * 2, y * 2]))
})

test('zoom motion preserves both completed endpoints and retains accepted evidence after a later rejection', () => {
    const layers = displayLayers([0, 0, 4096, 4096], [[64, 64], [1, 1]], [0, 0])
    let transforms = 0
    const selector = new DisplayGeometrySelector(layers, [0, 0], ([x, y]) => { transforms++; return [x, y] })
    const view = (scale: number) => [1280 - 128 / scale, 1280 - 96 / scale, 1280 + 128 / scale, 1280 + 96 / scale] as Bounds
    const coarse = selector.select(view(0.25), 0.25)
    selector.publish(selector.selectionId, true)
    for (const scale of [0.28, 0.32, 0.36, 0.4, 0.45]) {
        selector.select(view(scale), scale); selector.publish(selector.selectionId, false)
    }
    const fine = selector.select(view(0.5), 0.5)
    selector.publish(selector.selectionId, true)
    for (const scale of [0.45, 0.4, 0.36, 0.32, 0.28]) {
        selector.select(view(scale), scale); selector.publish(selector.selectionId, false)
    }
    transforms = 0
    assert.deepEqual(selector.select(view(0.25), 0.25), coarse)
    assert.equal(transforms, 0)
    selector.publish(selector.selectionId, true)
    transforms = 0
    assert.deepEqual(selector.select(view(0.5), 0.5), fine)
    assert.equal(transforms, 0)
})

test('an exact coarse rejection never overwrites an earlier complete acceptance proof', () => {
    const layers = displayLayers([0, 0, 64, 64], [[64, 64], [1, 1]], [0, 0])
    let transforms = 0
    const selector = new DisplayGeometrySelector(layers, [0, 0], p => { transforms++; return p })
    const viewport: Bounds = [0, 0, 64, 64]
    const fine = selector.select(viewport, 1.6)
    selector.publish(selector.selectionId, true)
    selector.select(viewport, 1.4)
    selector.publish(selector.selectionId, true)
    transforms = 0
    assert.deepEqual(selector.select(viewport, 1.6), fine)
    assert.equal(transforms, 0)
})

test('DPR 0.5 gives every selected node a physical pixel center, including translated clipped tails', () => {
    const dpr = 0.5, radius = requiredDisplayRadius(dpr)
    assert.equal(radius, 1.5)
    const origin: [number, number] = [0, 0]
    const bounds: Bounds = [-26, -10, 26, 10]
    const layers = displayLayers(bounds, [[13, 5], [1, 1]], origin)
    for (const [tx, ty] of [[0.37, 0.29], [0.91, 1.17], [-0.43, 0.71]]) {
        const screen = ([x, y]: [number, number]): [number, number] => [1.5 * x + tx, 1.5 * y + ty]
        const blocks = selectDisplayBlocks(layers, origin, bounds, screen, undefined, radius)
        assert.ok(blocks.length > 0)
        const missed = (selection: typeof blocks) => {
            let count = 0
            for (const block of selection) {
                const blockBounds = nodeBounds(displayLayer(layers, block.blockLayer), block.x, block.y, origin)
                const layer = displayLayer(layers, block.displayLayer)
                const [x0, y0, x1, y1] = nodeRange(layer, blockBounds, origin)
                for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
                    const node = nodeBounds(layer, x, y, origin)
                    const corners = projectedCorners(node, screen)
                    const [left, bottom] = corners[0], [right, top] = corners[2]
                    const px = Math.ceil(left * dpr - 0.5) + 0.5
                    const py = Math.ceil(bottom * dpr - 0.5) + 0.5
                    if (px > right * dpr + 1e-9 || py > top * dpr + 1e-9) count++
                }
            }
            return count
        }
        assert.equal(missed(blocks), 0, `DPR 0.5 selection misses a pixel center at ${tx},${ty}`)
        assert.ok(missed(selectDisplayBlocks(layers, origin, bounds, screen)) > 0,
            'the previous CSS-only threshold must expose the regression fixture')
        const selector = new DisplayGeometrySelector(layers, origin, ([x, y]) => [x, y])
        assert.deepEqual(selector.select(bounds, 1.5, radius), blocks)
        assert.deepEqual(selector.select(bounds, 1.5, requiredDisplayRadius(1)),
            selectDisplayBlocks(layers, origin, bounds, screen))
    }
})

const definition = '+proj=tmerc +lat_0=22.3121333333333 +lon_0=114.178555555556 +k=1 +x_0=836694.05 +y_0=819069.8 +ellps=intl +towgs84=-162.619,-276.959,-161.764,0.067753,-2.243649,-1.158827,-1.094246 +units=m +no_defs'

test('real EPSG2326 metadata near the 0.75 CSS boundary preserves exact per-node choices and DPR identity', () => {
    proj4.defs('EPSG:2326', definition)
    const projection = proj4('EPSG:2326', 'EPSG:4326')
    const origin: [number, number] = [808357.5, 830133.5]
    const layers = displayLayers([808357.5, 827445.5, 833573.5, 844213.5], [[64, 64], [32, 32], [16, 16], [8, 8], [4, 4]], origin, 1)
    const bounds: Bounds = [824400, 835500, 824800, 835800]
    const project = (p: [number, number]) => MercatorCoordinate.fromLonLat(projection.forward(p))
    const selector = new DisplayGeometrySelector(layers, origin, project)
    const unit = project([824600, 835650])
    for (const scale of [9195641.059280677, 13793461.588921, 13793461.6, 18391282.118561]) {
        const screen = (p: [number, number]): [number, number] => { const q = project(p); return [(q[0] - unit[0]) * scale, (q[1] - unit[1]) * scale] }
        const expected = selectDisplayBlocks(layers, origin, bounds, screen)
        for (const dpr of [1, 2]) {
            const radius = requiredDisplayRadius(dpr)
            assert.equal(radius, 0.75)
            assert.deepEqual(selector.select(bounds, scale, radius), expected)
        }
    }
})

test('prepared instance geometry preserves exact attributes, relative Mercator corners and 64-byte records', () => {
    const config = { layers: displayLayers([-4, -4, 4, 4], [[1, 1]], [0, 0]), origin: [0, 0] as [number, number], definition: JSON.stringify(proj4.defs('EPSG:3857')) }
    const engine = new DisplayGeometryEngine(config)
    const cells = [{ id: 42, bounds: [-4, -4, -2, -2] as Bounds, level: 1, elevation: 2.5, landClass: 3, deleted: true }]
    const fields = [{ bounds: [0, 0, 4, 4] as Bounds, level: 1, elevation: 9, landClass: 7, minCellSize: 0.25, occupiedFraction: 0.125 }]
    const [prepared] = engine.prepare([{ key: 'test', bounds: [-4, -4, 4, 4], cells, fields }])
    assert.equal(prepared.data.byteLength, 2 * 64)
    assert.deepEqual([...prepared.data.slice(8, 16)], [1, 2.5, 3, 2, 0, 1, 0, 1])
    assert.deepEqual([...prepared.data.slice(24, 32)], [1, 9, 7, 0.25, 4, 4, 0, 0.125])
    const convert = proj4('EPSG:3857', 'EPSG:4326')
    const corner = MercatorCoordinate.fromLonLat(convert.forward([-4, -2] as [number, number]))
    assert.equal(prepared.data[0], Math.fround(corner[0] - prepared.origin[0]))
    assert.equal(prepared.data[1], Math.fround(corner[1] - prepared.origin[1]))
})
