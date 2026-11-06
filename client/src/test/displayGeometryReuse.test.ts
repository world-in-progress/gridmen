import assert from 'node:assert/strict'
import test from 'node:test'
import proj4 from 'proj4'
import { DisplayGeometrySelector } from '../src/core/grid/displayGeometry'
import type { DisplayGeometryFootprint } from '../src/core/grid/displayGeometry'
import { DisplayGeometryEngine } from '../src/core/grid/displayGeometryEngine'
import { displayLayer, displayLayers, nodeBounds, nodeRange, projectedRadius, selectDisplayBlocks } from '../src/core/grid/displayHierarchy'
import { MercatorCoordinate } from '../src/core/math/mercatorCoordinate'
import type { Bounds, DisplayChunk } from '../src/core/grid/displayTypes'

const EARTH = 2 * Math.PI * 6378137
const config = () => ({ layers: displayLayers([0, 0, 1048576, 512], [[64, 64], [1, 1]], [0, 0]),
    origin: [0, 0] as [number, number], definition: JSON.stringify(proj4.defs('EPSG:3857')) })
interface Footprint { id: number; nodes: Set<string>; minima: Set<string>; bounds: Bounds[]; geometry: Map<string, DisplayGeometryFootprint> }
interface Vertex { x: number; y: number; world?: [number, number]; references: number }
interface State {
    points: Map<number, { points: Map<number, Vertex> }>
    geometryGroups: Map<string, Vertex[]>
    projection: { forward(point: [number, number]): [number, number] }
    selector: { current?: Footprint; published?: Footprint; settled: Footprint[]; nodes: Map<string, unknown>; minima: Map<string, unknown> }
}
function state(engine: DisplayGeometryEngine): State { return engine as unknown as State }
function assertBounded(engine: DisplayGeometryEngine): number {
    const { points, selector, geometryGroups } = state(engine)
    const live = [...new Set([selector.current, selector.published, ...selector.settled])].filter(v => v !== undefined)
    assert.ok(live.length <= 4)
    assert.ok(selector.settled.length <= 2)
    const work = new Map(live.flatMap(v => [...v.geometry]))
    const references = new Map<Vertex, number>()
    for (const [key, vertices] of geometryGroups) {
        const footprint = work.get(key)
        assert.ok(footprint, 'a retained group must belong to active selection work')
        const expected = new Set<string>()
        const quad = (b: Bounds) => { for (const x of [b[0], b[2]]) for (const y of [b[1], b[3]]) expected.add(`${x},${y}`) }
        if ('bounds' in footprint) quad(footprint.bounds)
        else {
            const [x0, y0, x1, y1] = footprint.range
            for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) quad(nodeBounds(footprint.layer, x, y, footprint.origin))
        }
        assert.equal(new Set(vertices).size, expected.size)
        for (const vertex of vertices) {
            assert.ok(expected.has(`${vertex.x},${vertex.y}`), 'spatial containment alone cannot justify a fine vertex')
            references.set(vertex, (references.get(vertex) ?? 0) + 1)
        }
    }
    let count = 0
    for (const [x, column] of points) for (const [y, vertex] of column.points) {
        assert.equal(vertex.x, x); assert.equal(vertex.y, y)
        assert.equal(vertex.references, references.get(vertex))
        assert.ok(vertex.references > 0)
        count++
    }
    assert.equal(count, references.size)
    for (const key of selector.nodes.keys()) assert.ok(live.some(v => v.nodes.has(key)))
    for (const key of selector.minima.keys()) assert.ok(live.some(v => v.minima.has(key)))
    const bound = [...geometryGroups.values()].reduce((n, vertices) => n + vertices.length, 0)
    assert.ok(count <= bound)
    return count
}

test('canonical partition changes reuse complete lattice minima while rejecting finer nodes exactly', () => {
    const layers = displayLayers([0, 0, 512, 256], [[64, 64], [1, 1]], [0, 0])
    let transforms = 0, fineTransforms = 0
    const project = (p: [number, number]) => { transforms++; if (p.some(v => v % 4 !== 0)) fineTransforms++; return p }
    const selector = new DisplayGeometrySelector(layers, [0, 0], project)
    const viewport: Bounds = [0, 0, 512, 256]
    const first = selector.select(viewport, 0.9)
    selector.publish(selector.selectionId, true)
    assert.ok(transforms > 32000)
    transforms = 0; fineTransforms = 0
    const second = selector.select(viewport, 1.1)
    assert.ok(first.some(b => !second.some(c => b.blockLayer === c.blockLayer && b.x === c.x && b.y === c.y)))
    assert.ok(second.every(b => b.displayLayer === 1))
    assert.ok(fineTransforms < 400, `partition change repeated ${fineTransforms} fine-node transforms`)
    assert.deepEqual(second, selectDisplayBlocks(layers, [0, 0], viewport, ([x, y]) => [x * 1.1, y * 1.1]))
})

test('engine vertices survive a partition change and are shared with exact preparation', () => {
    const engine = new DisplayGeometryEngine(config())
    const s = state(engine), original = s.projection.forward.bind(s.projection)
    let transforms = 0
    s.projection.forward = point => { transforms++; return original(point) }
    const viewport: Bounds = [4096, 0, 4608, 256]
    const first = engine.run({ type: 'select', bounds: viewport, scale: EARTH * 0.9 })
    engine.run({ type: 'publish', selection: first.selection!, stopped: true })
    assert.ok(assertBounded(engine) > 32000)
    transforms = 0
    engine.run({ type: 'select', bounds: viewport, scale: EARTH * 1.1 })
    assert.ok(transforms < 400)
    const chunk: DisplayChunk = { key: 'field', bounds: [4096, 0, 4160, 64], cells: [], fields: [] }
    for (let y = 0; y < 64; y += 2) for (let x = 4096; x < 4160; x += 2) {
        chunk.fields.push({ bounds: [x, y, x + 2, y + 2], level: 2, elevation: 1.5, landClass: 3, minCellSize: 1, occupiedFraction: 0.5 })
    }
    transforms = 0
    const actual = engine.prepare([chunk])
    assert.equal(transforms, 4, 'only the four public lon/lat chunk corners need proj4 again')
    assert.deepEqual(actual, new DisplayGeometryEngine(config()).prepare([chunk]))
    assertBounded(engine)
})

test('stopped resolutions with identical scalar proof keys retain their distinct geometry work', () => {
    const engine = new DisplayGeometryEngine({ layers: displayLayers([0, 0, 16, 16], [[16, 16], [1, 1]], [0, 0]),
        origin: [0, 0], definition: JSON.stringify(proj4.defs('EPSG:3857')) })
    const view: Bounds = [0, 0, 16, 16]
    const stop = (bounds: Bounds, factor: number) => {
        const result = engine.run({ type: 'select', bounds, scale: EARTH * factor })
        engine.run({ type: 'publish', selection: result.selection!, stopped: true })
        return state(engine).selector.current!
    }
    const fine = stop(view, 1.6), coarse = stop(view, 1.4)
    assert.deepEqual(fine.nodes, coarse.nodes)
    assert.deepEqual(fine.minima, coarse.minima)
    assert.equal(state(engine).selector.settled.length, 2)
    assert.ok(state(engine).points.get(5)?.points.get(5)?.world)
    const s = state(engine), project = s.projection.forward.bind(s.projection)
    let transforms = 0
    s.projection.forward = point => { transforms++; return project(point) }
    stop(view, 1.6)
    assert.equal(transforms, 0, 'the stopped fine endpoint must retain exact values even when scalar footprints coincide')
    assertBounded(engine)
    stop([12, 12, 14, 14], 64)
    stop(view, 1.4)
    assert.ok(!state(engine).points.get(5)?.points.has(5), 'fine geometry must expire with its last actual owner')
    assertBounded(engine)
})

test('unpublished candidates, published motion and two stopped views bound repeated distant pans', () => {
    const engine = new DisplayGeometryEngine(config())
    const select = (x: number) => engine.run({ type: 'select', bounds: [x, 0, x + 128, 128], scale: EARTH * 0.9 })
    const publish = (selection: number, stopped: boolean) => engine.run({ type: 'publish', selection, stopped })
    const first = select(0)
    publish(first.selection!, true)
    const initial = assertBounded(engine)
    for (let round = 0; round < 3; round++) for (const x of [8192, 65536, 262144, 786432, 4096]) {
        const candidate = select(x)
        assertBounded(engine)
        const latest = select(x + 2048)
        assertBounded(engine)
        assert.throws(() => publish(candidate.selection!, true), /Expired/)
        publish(latest.selection!, false)
        assertBounded(engine)
        const stopped = select(x + 4096)
        publish(stopped.selection!, true)
        assert.ok(assertBounded(engine) <= initial * 3, 'retention grew with visited regions')
    }
    assert.ok(!state(engine).points.get(1)?.points.has(1), 'an expired distant endpoint must be evicted')
})

test('crossing originals and local edits cannot enlarge retained vertex footprints; reset drops vertices', () => {
    const engine = new DisplayGeometryEngine(config())
    const selected = engine.run({ type: 'select', bounds: [4096, 0, 4224, 128], scale: EARTH * 0.9 })
    engine.run({ type: 'publish', selection: selected.selection!, stopped: true })
    const original: DisplayChunk = { key: 'original:1', bounds: [0, -1024, 8192, 1024], fields: [],
        cells: [{ id: 1, bounds: [0, -1024, 8192, 1024], level: 1, elevation: 2, landClass: 7 }] }
    for (let i = 0; i < 5; i++) {
        original.cells[0] = { ...original.cells[0], elevation: i, deleted: i % 2 === 0 }
        const [prepared] = engine.prepare([original])
        assert.deepEqual(prepared, new DisplayGeometryEngine(config()).prepare([original])[0])
        assertBounded(engine)
        assert.ok(!state(engine).points.get(0)?.points.has(-1024))
    }
    engine.run({ type: 'reset' })
    assert.equal(state(engine).points.size, 0)
    assert.deepEqual(engine.prepare([original]), new DisplayGeometryEngine(config()).prepare([original]))
    assertBounded(engine)
})

test('failed selection and preparation drop partial geometry without expiring the published view', () => {
    const engine = new DisplayGeometryEngine(config())
    const selected = engine.run({ type: 'select', bounds: [4096, 0, 4224, 128], scale: EARTH * 0.9 })
    engine.run({ type: 'publish', selection: selected.selection!, stopped: true })
    const count = assertBounded(engine)
    const s = state(engine), project = s.projection.forward.bind(s.projection)
    let remaining = 5
    s.projection.forward = point => { if (!remaining--) throw new Error('projection failed'); return project(point) }
    assert.throws(() => engine.run({ type: 'select', bounds: [65536, 0, 65664, 128], scale: EARTH * 0.9 }), /projection failed/)
    assert.equal(assertBounded(engine), count)
    assert.equal(s.selector.current?.id, selected.selection)
    remaining = 5
    assert.throws(() => engine.prepare([{ key: 'failed', bounds: [65536, 0, 65664, 128], cells: [], fields: [] }]), /projection failed/)
    assert.equal(assertBounded(engine), count)
    s.projection.forward = project
    engine.run({ type: 'publish', selection: selected.selection!, stopped: true })
    assertBounded(engine)
})

test('a stopped full-domain view cannot retain the fine geometry of expired detailed views', () => {
    const source = { layers: displayLayers([0, 0, 8192, 256], [[64, 64], [1, 1]], [0, 0]),
        origin: [0, 0] as [number, number], definition: JSON.stringify(proj4.defs('EPSG:3857')) }
    const far: Bounds = [-2304, -3872, 10496, 4128]
    const near = (i: number): Bounds => [i * 768, 3, i * 768 + 400, 253]
    const stop = (engine: DisplayGeometryEngine, bounds: Bounds, mpp: number) => {
        const result = engine.run({ type: 'select', bounds, scale: EARTH / mpp })
        engine.run({ type: 'publish', selection: result.selection!, stopped: true })
        return result.blocks
    }
    const count = (e: DisplayGeometryEngine) => [...state(e).points.values()].reduce((n, column) => n + column.points.size, 0)
    const keys = (e: DisplayGeometryEngine) => [...state(e).points].flatMap(([x, c]) => [...c.points.keys()].map(y => `${x},${y}`)).sort()
    const work = (e: DisplayGeometryEngine) => {
        const s = state(e).selector
        return [...new Set([s.current, s.published, ...s.settled])].filter(v => v !== undefined)
            .map(v => ({ bounds: v.bounds, nodes: [...v.nodes].sort(), minima: [...v.minima].sort(), geometry: [...v.geometry.keys()].sort() }))
    }
    const expected = Array.from({ length: 8 }, (_, i) => {
        const fresh = new DisplayGeometryEngine(source)
        stop(fresh, far, 8); stop(fresh, near(i), 0.25); stop(fresh, far, 8)
        return { count: count(fresh), engine: i === 7 ? fresh : undefined }
    })
    const engine = new DisplayGeometryEngine(source)
    stop(engine, far, 8)
    let expired: number | undefined
    for (let round = 0; round < 3; round++) for (let i = 0; i < 8; i++) {
        stop(engine, near(i), 0.25)
        expired ??= state(engine).selector.current!.id
        stop(engine, far, 8)
        assert.equal(count(engine), expected[i].count, 'retention must depend on active work, not the number of detailed views visited')
        if (i > 0) assert.ok(!state(engine).points.get(5)?.points.has(5))
    }
    const fresh = expected[7].engine!
    assert.deepEqual(keys(engine), keys(fresh))
    assert.deepEqual(work(engine), work(fresh))
    assertBounded(engine)
    assert.throws(() => engine.run({ type: 'publish', selection: expired!, stopped: true }), /Expired/)
})

const definition = '+proj=tmerc +lat_0=22.3121333333333 +lon_0=114.178555555556 +k=1 +x_0=836694.05 +y_0=819069.8 +ellps=intl +towgs84=-162.619,-276.959,-161.764,0.067753,-2.243649,-1.158827,-1.094246 +units=m +no_defs'
test('captured EPSG2326 field and cell metadata releases fine geometry inside the global view', () => {
    const origin: [number, number] = [808357.5, 830133.5]
    const layers = displayLayers([808357.5, 827445.5, 833573.5, 844213.5], [[64, 64], [32, 32], [16, 16], [8, 8], [4, 4]], origin, 1)
    proj4.defs('GEOMETRY_REUSE_2326', definition)
    const source = { layers, origin, definition: JSON.stringify(proj4.defs('GEOMETRY_REUSE_2326')) }
    const far: Bounds = [795164.9076039209, 819779.2668202078, 846794.3100313571, 851880.9266488655]
    const stop = (engine: DisplayGeometryEngine, offset?: number) => {
        const bounds: Bounds = offset === undefined ? far : [origin[0] + offset, origin[1] + 4096, origin[0] + offset + 128, origin[1] + 4224]
        const result = engine.run({ type: 'select', bounds, scale: offset === undefined ? 1149465.7813554124 : 73565117.82585835 })
        engine.run({ type: 'publish', selection: result.selection!, stopped: true })
        return result.blocks
    }
    const keys = (engine: DisplayGeometryEngine) => [...state(engine).points].flatMap(([x, c]) => [...c.points.keys()].map(y => `${x},${y}`)).sort()
    const engine = new DisplayGeometryEngine(source), fresh = new DisplayGeometryEngine(source)
    stop(engine)
    for (let round = 0; round < 3; round++) for (let i = 1; i <= 8; i++) {
        stop(engine, i * 2048); stop(engine)
        if (i > 1) assert.ok(!state(engine).points.get(origin[0] + 2052)?.points.has(origin[1] + 4100))
    }
    stop(engine, 20480); const actual = stop(engine)
    stop(fresh); stop(fresh, 20480); const expected = stop(fresh)
    assert.deepEqual(actual, expected)
    assert.deepEqual(keys(engine), keys(fresh))
    assertBounded(engine)
})

const schemas: [number, number][][] = [
    [[13, 13], [1, 1]], [[5, 7], [1, 1]], [[13, 5], [1, 1]], [[3.9, 3.5], [0.3, 0.7]],
    [[64, 1], [1, 1]], [[1, 64], [1, 1]], [[65, 21], [13, 7], [1, 1]],
]
for (const sizes of schemas) test(`row reuse preserves EPSG2326 tails, skinny blocks and ancestors for ${JSON.stringify(sizes)}`, () => {
    const origin: [number, number] = [820965.13, 835829.39]
    const [w, h] = sizes[0]
    const bounds: Bounds = [origin[0] - w, origin[1] - h, origin[0] + w * 2, origin[1] + h * 2]
    const layers = displayLayers(bounds, sizes, origin)
    const projection = proj4(definition, 'EPSG:4326')
    const project = (p: [number, number]) => MercatorCoordinate.fromLonLat(projection.forward(p))
    const center = project(origin)
    const selector = new DisplayGeometrySelector(layers, origin, project)
    proj4.defs('GEOMETRY_SCHEMA_2326', definition)
    const engine = new DisplayGeometryEngine({ layers, origin, definition: JSON.stringify(proj4.defs('GEOMETRY_SCHEMA_2326')) })
    let ancestor = false
    for (const factor of [0.001, 0.6, 1.4, 1.51, 2, 4, 1.51, 0.001]) {
        const scale = factor * EARTH
        const screen = (p: [number, number]): [number, number] => { const q = project(p); return [(q[0] - center[0]) * scale, (q[1] - center[1]) * scale] }
        const result = selector.select(bounds, scale)
        assert.deepEqual(result, selectDisplayBlocks(layers, origin, bounds, screen))
        const cached = engine.run({ type: 'select', bounds, scale })
        assert.deepEqual(cached.blocks, result)
        engine.run({ type: 'publish', selection: cached.selection!, stopped: factor === 0.001 || factor === 4 })
        assertBounded(engine)
        for (const block of result) {
            ancestor ||= block.displayLayer >= layers.length
            const layer = displayLayer(layers, block.displayLayer)
            const [x0, y0, x1, y1] = nodeRange(layer, nodeBounds(displayLayer(layers, block.blockLayer), block.x, block.y, origin), origin)
            for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
                assert.ok(projectedRadius(nodeBounds(layer, x, y, origin), screen) + 1e-9 >= 0.75)
            }
        }
        selector.publish(selector.selectionId, factor === 0.001 || factor === 4)
    }
    assert.ok(ancestor, 'the finite prefix must continue to coarse ancestors')
})

test('rejected ranges do not eagerly project later nodes outside the finite projection domain', () => {
    const layers = displayLayers([0, 0, 64, 64], [[64, 64], [1, 1]], [0, 0])
    const projection = ([x, y]: [number, number]): [number, number] => {
        if (x === 3 && y === 1) throw new Error('unneeded later fine vertex')
        return [x, y]
    }
    const selector = new DisplayGeometrySelector(layers, [0, 0], projection)
    assert.deepEqual(selector.select([0, 0, 64, 64], 0.8), selectDisplayBlocks(layers, [0, 0], [0, 0, 64, 64], ([x, y]) => [x * 0.8, y * 0.8]))
})
