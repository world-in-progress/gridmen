# Viewport grid display

The patch editor and assembled-grid viewer share `TopologyLayer`. Display blocks and nodes belong to the grid-coordinate hierarchy and are independent of editable patches. Inspection and editing continue to address original cells and segmented edges.

## Hierarchy and selection

`displayLayers` is ordered finest to coarsest and exposes the server's finite stored `layer_specs`: native schema lattices, dyadic intermediate lattices, and coarse ancestors. Each entry has `width`, `height`, `x0`, `y0`, `nx`, `ny`, `nativeLevel`, `xLayout`, and `yLayout`. Native levels keep their original schema numbers; intermediate levels have `nativeLevel: null`. A non-null axis layout is `[nativeParentPeriod, intervalsPerParent]`; intervals reset in each native parent and the last interval is clipped to that parent. Client and stored layer ranges use the same half-open lattice bounds, including negative coordinates and upper bounds at the alignment origin. Original geometry is never resampled.

The last stored layer covers the grid with at most two nodes per axis. Its grid hierarchy continues implicitly: ancestor `k` doubles both dimensions `k` times, has no native level or clipped layout, and groups stored-root indices by floor division by `2^k`. Its axis range is `[floor(rootStart / 2^k), ceil(rootEnd / 2^k))`. Layer numbers continue beyond the metadata array without a storage-dependent zoom limit. These are complete grid-coordinate nodes with the same alignment origin.

The client partitions the visible grid into complete hierarchical blocks, normally no more than 128 raster pixels along an edge. A block is one node identified by `(blockLayer, x, y)`. It ascends beyond storage roots until each visible root satisfies the circle condition, and subdivides a block only when every visible child also satisfies it. A narrow child retains its valid parent even when that parent exceeds the usual 128-pixel edge size. For each block it selects the finest `displayLayer <= blockLayer` whose projected nodes all contain an inscribed circle of radius 0.75 raster pixels, including clipped last strips. All four corners of each candidate node use the existing grid-to-map projection; projection nonlinearity inside a node is ignored. Adjacent dyadic levels normally give 1.5–3 raster-pixel nodes. The circle exceeds the square pixel-center lattice's covering radius, so ordinary center-sampled rasterization lights at least one pixel in every nonempty display node, independently of subpixel placement. Field nodes have no outlines.

Raster pixels are the actual drawing-buffer pixels, with centers at `(i + 0.5, j + 0.5)`. Selection multiplies public Mapbox CSS coordinates by `canvas.width / canvas.clientWidth`. Original-cell widths, the fixed four-pixel transition, and the one-pixel centered outline remain in **CSS pixels**. Thus the transition is at four CSS pixels at DPR 1 and DPR 2, while the minimum display-node diameter remains 1.5 drawing-buffer pixels.

An original cell at or above the selected display layer is returned and drawn in its own original bounds. A large original spanning several requested blocks has one draw instance, deduplicated by its real cell ID.

## Camera-independent summaries

Initial index construction combines nodes bottom-up once. Each node retains occupied cell area, elevation multiplied by occupied area, the full sparse class-area histogram, the finest original level, and the true smallest original cell side. Native originals supply their single class directly; summary histograms remain in the persisted index. Work follows stored nodes and sparse entries rather than global class count times all nodes.

Elevation is `elevationArea / occupiedArea`. Class weights use arbitrary-precision integer counts of the common finest-lattice area unit, obtained from successive native integer ratios. This preserves decimal-grid equalities and one-unit differences above the float64 integer range. Occupied and elevation totals remain physical float64 values. The class with greatest total area wins; a true equality selects the smaller code. Combining child winners is invalid: three children that are 51% B and a fourth entirely A give 61.75% A overall. Occupancy is `occupiedArea / nodeArea`, including source boundaries and holes. Summaries contain no camera weights and do not descend to leaves for partially covered screen pixels.

The editable index uses the same hierarchy. Requested ancestors above the stored prefix are built only from the bounded roots and extended one level at a time. An insertion or removal updates one native node and its materialized ancestor path in O(depth). Sparse class weights receive the cell's signed exact area-unit contribution; physical totals and extrema are refreshed from the bounded children. Recomputing nonnegative totals preserves a tiny remaining cell when a much larger cell is removed, and deletion state is tracked independently of rounded occupied areas. Cache invalidation follows those same ancestor coordinates. Unchanged blocks retain object identity, revisions, and GPU buffers. Initial loading uses the bottom-up build rather than repeated viewport rebuilding. Selection opacity queries the same display node in a separate sparse selection index.

## Rendering and density

Geometry uploads are relative to each chunk's double-precision Mercator origin. Each instance uses sixteen float32 GPU values; source and HTTP geometry and attributes remain float64. Field color and opacity are premultiplied by occupancy once. At a fragment center, `c` is the covering node's true minimum real cell side, or the side of an original cell drawn in its own right. A refinement can darken its whole display node and must light at least one pixel.

Original cells retain fills and one-CSS-pixel centered outlines. The shader box-filters each half-width outline against the actual device pixel and combines horizontal and vertical line coverage. For a uniform square grid:

```
u = min(1, s / c)
coverage = 1 - (1 - u)^2
```

Here `s` is grid distance per CSS pixel in the same convention as the actual outline. At four CSS pixels per cell, coverage is 0.4375. The CPU helper, shader, and density legend use this formula. A smooth handoff from density at four pixels to complete original outlines at eight pixels avoids a brightness jump. The real shader is tested immediately on both sides of four pixels; the difference in average darkening must be below 0.01. Level, elevation, land-class, and density colors are shared with the legend. A map-adjacent field indicator and the display panel use English and Chinese text.

## HTTP API

All routes are below `/api/grid/{node_key}/display`.

- `GET /meta` returns the grid's CRS, bounds, schema, final attribute ranges/classes, original cell count, immutable `revision`, and `displayLayers`.
- `GET /nodes/{revision}/{blockLayer}/{x}/{y}/{displayLayer}` returns complete summaries at the selected layer inside that block, plus intersecting originals on coarser native layers. Both layer numbers may address implicit ancestors beyond the stored metadata prefix. The response depends only on this tuple. An outdated revision returns 409; invalid block coordinates or layer selection return 422.
- `GET /inspect?x={gridX}&y={gridY}` returns the original containing cell, its original neighbors by side, and every original segmented edge ID.

Node responses use `application/octet-stream`. The eight-byte header is ASCII `GDN4`, then an unsigned little-endian 32-bit record count. Each following 72-byte record is little-endian `<Q7dII`:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | uint64 | True original ID; zero denotes a summary |
| `x0, y0, x1, y1` | four float64 | Grid-CRS bounds; originals retain their exact binary-file values |
| `occupiedArea` | float64 | Sum of original occupied areas |
| `elevationArea` | float64 | Sum of elevation multiplied by original area |
| `minCellSize` | float64 | True smallest contributing original side |
| `level` | uint32 | Finest contributing original schema level |
| `landClass` | uint32 | Winner of the full class-area histogram |

The client validates metadata and binary responses at their source boundaries, including exact length, finite values, occupancy, and safe integer IDs. The wire contains resolved class winners; the server retains the complete sparse histograms for aggregation. There is one reader and no former camera/viewport query route.

Node responses carry an ETag and `Cache-Control: public, max-age=31536000, immutable`, vary by `Accept-Encoding`, and support gzip and conditional 304 responses. The client uses ordinary browser HTTP caching; it does not access Mapbox's private `SourceCache` or add a general request scheduler. The server performs no projection, screen clipping, or camera-dependent field computation. Selected-layer lookup uses a spatial R-tree over sparse tiles. A second R-tree stores the exact rectangles and IDs of coarser native originals, so holes cannot turn coarse-tile candidates into a scan of unrelated cells. Each block performs at most two indexed lookups; selected-tile work is bounded by the viewport block, and coarse originals are processed in proportion to returned originals. Queries at implicit ancestor layers combine at most four stored roots and their complete exact class histograms, with occupancy measured against the complete ancestor node area. They require no fine-layer or original-geometry access and allocate no additional stored layers. Query cost is O(log N + output), independent of unresolved fine leaves or property-boundary complexity. Client block selection bounds requested output by the viewport.

## Lifecycle and real topology

Camera work retains a single in-flight view load and one latest pending camera. Public camera events coalesce into one animation frame. Movement requests and commits current visible blocks before stopping, while preserving usable data and evicting hidden GPU blocks. The single active load drains only the latest pending view; the stopped camera also receives its final update. Each draw uses the current CSS camera scale, including while network data is pending. Per-chunk minimum cell size makes mode detection independent of the number of original instances. Edits refresh immediately and reuse the current camera's block selection. Only visible blocks allocate GPU buffers, with one 64-byte instance per drawn sample and the shared palette; hidden blocks release their allocations. There is no fixed maximum-cell allocation or capacity bar.

Pitch and bearing are fixed at zero by the main map's camera controls. Display selection uses the four viewport corners, with no tilted-camera edge sampling or distance bands. Pan and zoom remain available. Original half-open bounds determine click ownership, including beside holes and across hanging edges. Read-only inspection does not acquire edit permissions. Patch selection, deletion/recovery, storage compaction, context restoration, and the existing render/edit benchmark interfaces remain available.

The server reads validated assembled-grid files and final scenario attributes from `ne.txt` and `ns.txt`. It does not assemble, resample, or prerender imagery for viewing. File and interface validation happens at boundaries; failures remain explicit. Hardware performance and screenshots are separate from software WebGL correctness checks.

`npm test` runs the frontend unit suite. On macOS with Chrome installed, `npm run test:browser` runs the production WebGL shader and lifecycle fixture through actual animation frames. It uses headless SwiftShader for correctness only; its frame timings are not hardware performance evidence. Node.js 22.12 or newer supplies the native WebSocket used for Chrome DevTools Protocol control.
