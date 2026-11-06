# Viewport grid display

Display chunks are aligned to the schema lattice and quadtree hierarchy, and are independent of editable patches. The editor and assembled-grid viewer share one renderer. Inspection always queries original cells and segmented edges.

## Display nodes

Samples are nodes in the grid's coordinate system. Native schema levels are joined by dyadic intermediate levels from `layer_specs`; an integer ratio that is not a power of two has a clipped final interval.

For each visible block, select the finest display level whose nodes, including clipped final intervals, each contain an inscribed screen-space circle of radius 0.75 raster pixels. Adjacent dyadic levels normally produce nodes about 1.5–3 pixels wide. A circle of that radius exceeds the square pixel-center lattice's covering radius, so ordinary center-sampled rasterization lights at least one pixel for every nonempty display node. Do not replace this rule with a one-pixel node bound or conservative rasterization.

An original cell larger than the selected display node is drawn as that original cell. Display nodes are never computational cells and have no drawn edges.

## Camera-independent summaries

Build a bottom-up summary index once per grid revision. Every node retains:

- occupied cell area and its fraction of the node area;
- elevation multiplied by occupied area, for an area-weighted mean;
- a sparse histogram of area by land-class code; the largest total area wins, with the lowest code breaking a tie;
- the finest original level and corresponding smallest original cell side.

Combine complete category areas, never child winners. Three children that are 51% class B and one child entirely class A have 61.75% class A overall.

Patch edits update the modified cell's ancestor paths in O(depth) per cell, with only affected display blocks rebuilt. Source boundaries and holes are represented by occupancy. Their partially occupied nodes remain visible with proportional opacity.

## Rendering

Project the four node corners using the existing grid-to-map projection. Ignore projection nonlinearity inside a node. Multiply premultiplied color and opacity by the node's occupied fraction.

At a fragment center, c is the smallest real cell side stored by the covering display node, or by an original cell drawn in its own right. A node containing refinement must light at least one pixel. The resulting darkening may extend across that display node; no exact per-screen-pixel geometric reduction, conservative rasterization, or max-compositing pass is required.

Cells at the fixed four-pixel transition retain original fills and outlines. Field samples have no outlines. Derive field density from the actual original-cell line rasterization. A one-pixel centered outline on a uniform square grid has coverage

```
u = min(1, s / c)
coverage = 1 - (1 - u)^2
```

where s is the grid distance per pixel in the same screen-width convention as the real outline. At four pixels per cell the coverage is 0.4375. Keep the density and actual line widths in one consistent CSS/device-pixel convention. Test the real renderer immediately on both sides of the transition: the difference in average darkening must be below 0.01. Do not retain the former `2*s/c` approximation.

The level, elevation and land-class palettes are shared with the legend. Show a visible field-mode indicator when any visible region uses field samples. UI text is available in English and Chinese.

## Requests and cost

The client requests summaries by grid revision, spatial block and display level. Responses are camera independent and reusable across pan and zoom whenever that tuple is unchanged. Server queries perform no camera-space projection, polygon clipping, or per-camera rasterization.

Query cost is O(log N + output), and output is bounded by the viewport. It must not depend on the total number of unresolved original cells or on geometry and property-boundary complexity. Use the existing hierarchy and mature HTTP/browser caching where sufficient; do not depend on private Mapbox SourceCache APIs or introduce a general cache scheduler.

Only visible chunks have GPU buffers. Allocate for actual visible data, release hidden chunks, and rebuild only changed blocks. There is no maximum-cell allocation, capacity limit or second legacy display reader.

The server reads validated assembled-grid files and final attributes from `ne.txt`/`ns.txt`. It does not assemble, resample, or prerender image tiles for viewing. Input and file validation occurs at boundaries; internal operations use the established invariants and failures are explicit.

## Fixed camera and real topology

Both editing and read-only viewing have pitch and bearing fixed at zero. Disable every drag, touch and keyboard tilt/rotation entry point, not only the initial pitch or `pitchWithRotate`. Remove code whose only purpose is tilted or rotated camera support. Keep ordinary pan and zoom.

Inspection is independent of display summaries. A click at any scale returns the original containing cell and its original adjacent cells, including multiple neighbors across hanging edges. Ownership uses original half-open cell bounds. Read-only inspection does not acquire edit permissions.
