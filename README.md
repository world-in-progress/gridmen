# Gridmen

English | [中文](README_zh.md)

Gridmen is a tool for researchers and engineers to create and edit multi-resolution Cartesian grids (MRCGs) for two-dimensional flood simulation. A grid consists of a base grid and ordered vector interventions. Assembly combines patches and samples terrain and LULC once into the base grid; other scenario grids derive from that base without repeating assembly or base-attribute sampling. They reuse identical base binaries, and computational cells outside the interventions retain bitwise-identical attributes across scenarios using the same base. Gridmen exports solver-independent cell–edge topology and attributes as `ne.txt` and `ns.txt`, usable by solvers such as the separate nh-flood-2d project.

[Watch the demonstration video](https://doi.org/10.6084/m9.figshare.32677584).

## Concepts and workflow

- **Grid levels:** a `schema` defines the coordinate reference system, alignment origin, and cell dimensions at each level. Dimensions decrease between levels; each preceding dimension must be an integer multiple of the next.
- **Patch:** an editable part of the grid, created within a schema. Subdivide, merge, delete, and recover computational cells to set the local resolution and extent.
- **Base grid:** geometry, topology, and base attributes produced by assembly. Assembly combines patches, resolves ancestor conflicts, applies grading, rebuilds topology, and samples DEM and optional LULC. The base binaries are subsequently immutable.
- **Vector intervention:** a vector resource with an elevation operation and/or a LULC assignment. Interventions execute in list order; later operations act on the results of earlier operations.
- **Solver input:** export a grid to obtain its base files, scenario-specific `ne.txt` and `ns.txt`, and build report.

A typical workflow is:

1. Create a project and a schema with the required coordinate reference system, alignment origin, and grid levels.
2. Create and edit patches under that schema to cover the simulation domain at the required resolutions.
3. Create a grid from the patches, a DEM, and optional LULC. Raster coordinates must already match the grid coordinate reference system; assembly does not reproject them.
4. Create or import vector resources, then add their elevation and/or LULC operations in the required order when creating a grid.
5. For another scenario, select an existing grid as **Base Grid** and choose the new ordered vector interventions. Derivation reuses its base attributes, without inheriting its intervened solver input. The base files must be on the same filesystem because reuse uses hard links. `crest` also requires the recorded DEM to remain accessible.
6. Use **Export Grid** to download the grid archive. Supply `ne.txt` and `ns.txt` to a compatible solver and configure the simulation in that solver.

Source DEM, LULC, and vector data must be supplied with appropriate usage rights.

## Viewing grid resolution and attributes

Choose **Check** on an assembled grid to browse it read-only. The patch editor and assembled-grid viewer share a renderer that loads and draws visible display chunks aligned to the schema lattice. Display chunks are independent of patches; editing rebuilds the chunks containing changed cells, and GPU buffers are allocated for the visible chunks rather than a fixed total-cell capacity.

Cells at least 4 CSS pixels wide retain their original fills and one-CSS-pixel centered outlines. Smaller regions use grid-coordinate display nodes without grid lines. Native schema levels are joined by dyadic intermediate levels; the client chooses each block's finest layer whose nodes, including clipped final strips, contain a circle of radius 0.75 CSS pixels. The same hierarchy continues beyond stored roots for distant zooms, and subdivision retains a valid parent when a narrow child cannot contain that circle. The usual node diameter is 1.5–3 CSS pixels, independently of DPR. Darkening follows `u = min(1, s/c); coverage = 1 - (1 - u)^2`, where `s` is meters per CSS pixel and `c` is the node's smallest real cell side; coverage is 0.4375 at four CSS pixels. The shared legend and a map-adjacent field indicator explain the display in English and Chinese.

Camera-independent summaries retain occupied area, area-weighted elevation, every sparse class-area total, and the true finest cell size. Class ties select the smaller code, and holes reduce opacity through occupancy. The browser requests reusable binary blocks by grid revision, block, and display layer, using standard HTTP caching. Server lookup does not traverse unresolved fine leaves or depend on camera or property boundaries. Large originals spanning blocks are drawn once; local edits update ancestor paths and affected buffers.

The first view builds reusable summaries from the assembled files with batch validation, recording each file's size, modification time, and SHA256. Later opens compare size and modification time; a change rebuilds the summaries. Each completed generation is published atomically, so existing readers can finish using their original generation.

A dedicated browser worker selects Mercator display blocks, validates their responses, and prepares projected geometry. It transfers validated bytes and prepared geometry back one block at a time; the main thread restores the exact attributes before acknowledging the next input. Obsolete zoom or edit work stops at that boundary. Geometry and decoded-block caches retain the candidate, displayed view, and two most recent completed stopped views. Projected vertices are retained by the work those views actually use, so a coarse view cannot retain previously visited fine geometry. GPU buffers retain only the currently visible chunks.

The assembled-grid viewer offers level, elevation, and land-class fields. Elevation and land class reflect the final scenario attributes in `ne.txt`, including vector interventions. Click the map in **Check**, or enable the patch editor's checking tool, to inspect the original cell and its neighbors at any scale. The inspector includes every segmented edge at coarse/fine boundaries; field samples are never reported as computational cells.

## Quick start

Use Node.js 22.12 or newer and npm, Python 3.12 (the version selected by `server/.python-version`), and `uv`. The backend manifest allows Python 3.10 or newer, subject to the locked dependencies. Native GDAL libraries and Python bindings must match; on macOS the manifest pins GDAL 3.13.1. See the manifests for the complete dependency lists.

From a fresh checkout:

```bash
git clone https://github.com/Dsssyc/gridmen.git
cd gridmen
npm run doctor
npm run setup
cp client/src/.env.example client/src/.env
```

`doctor` checks the local tools and GDAL linkage. `setup` runs `npm ci` at the root, in `client/`, and in `client/src/`, installs the Electron runtime, and runs `uv sync` in `server/`.

Set the renderer's `VITE_API_BASE_URL` in `client/src/.env` to the backend URL (default `http://127.0.0.1:8000`). The older `VITE_LOCAL_API_URL` remains a fallback. For Mapbox styles, set `VITE_MAP_TOKEN` to your own public Mapbox token, or enter it in **Settings → Map View → General**. Without a valid public token, the map view opens but Mapbox styles cannot load. Client environment values are visible to the browser.

### Desktop

```bash
npm start
```

This starts the Electron shell, Vite at `http://127.0.0.1:5173`, and the backend on port 8000. Press Ctrl+C in that terminal to stop the supervised processes. The Electron shell loads the Vite URL; an independently started shell needs a running renderer and backend.

### Web and backend separately

Run these in separate terminals from the repository root:

```bash
npm run start:server
npm run dev:web
```

Open the Vite URL in a browser. Vite proxies `/api` and `/noodle` to the configured backend. To start only the desktop shell after those two services are running:

```bash
npm run start:client
```

The direct server entry point is:

```bash
cd server
uv run main.py
```

The backend binds to `0.0.0.0`, uses `SERVER_PORT` (default 8000), and enables reload. Its default database, temporary state, configuration, and resources are under `server/`. `SQLITE_PATH`, `MEMORY_TEMP_PATH`, and `NOODLE_CONFIG_PATH` can be configured through `server/.env`; resource paths are relative to the backend working directory. Supply your own raster and vector files on the backend machine. Desktop file selection uses native dialogs; for Web use, file paths must refer to files accessible to the backend.

For development checks:

```bash
cd server
uv run pytest tests
```

```bash
cd client/src
npx tsc -b
npm run build
```

The renderer build writes to the repository-root `templates/` directory. Benchmark instructions are in [docs/benchmark/patch-render-benchmark.md](docs/benchmark/patch-render-benchmark.md). The display API and field aggregation rules are documented in [docs/viewport-grid-contract.md](docs/viewport-grid-contract.md).

## Vector elevation interventions

The selection rule is: polygons select computational cells by centre and edges by midpoint inside the polygon; lines select cells and edges they cross or touch; points select cells and edges containing the point. Vector coordinates are transformed into the grid coordinate reference system. The same operation applies to selected cells and edges, except for the special edge rule of `crest`.

| Operation | Elevation result |
|---|---|
| `set` | Set the selected elevation to the supplied value. |
| `add` | Add the supplied value to the current elevation. |
| `subtract` | Subtract the supplied value from the current elevation. |
| `max` | Flatten the selection to its highest current computational-cell elevation; no value is required. |
| `crest` | For lines only, raise each selected cell to the maximum of its current elevation, the highest valid DEM pixel-centre elevation in its footprint, and an optional design minimum. |

For `crest`, the footprint is a round-ended corridor on both sides of the line. Its radius is half the finest schema cell side (the smaller dimension for rectangular cells), including when the selected cell is coarse. The DEM maximum is taken within the footprint intersected with each selected cell. Pixel centres on the corridor boundary are included; cell bounds are half-open. For example, `{"type": "crest", "value": 3.07}` supplies a design minimum. Omitting `value`, passing `null`, or leaving the UI field blank supplies no design minimum; the current elevation is still preserved as a lower bound.

Crossed or touched edges retain at least their previous elevation and the highest final elevation of adjacent selected cells, including across refinement levels. Later interventions still apply in order and may change those elevations. New base grids record the sampling DEM path in `grid.meta.json`; derived grids inherit it. `crest` reads local windows, requires the DEM to have the grid coordinate reference system and a north-up, unrotated transform, and requires full footprint coverage. It fails if a selected cell footprint has no valid DEM pixel centres.

An intervention can also `set` LULC for the selected cells and edges, with or without an elevation operation. The code field `lum` denotes LULC. Every grid computes its solver input afresh from base attributes and its ordered interventions; exporting does not modify the base binaries or compound a previous scenario's edits.

Base sampling reads band 1. A cell takes the mean elevation and the majority LULC class (ties go to the smaller class value) of the valid pixels whose centres fall in its footprint; a cell holding at most one pixel centre reads that pixel, or the pixel at its centre. An edge reads the pixel at its midpoint. Without a valid pixel, the elevation becomes `-9999` and the LULC class `0`.

## Export files

**Export Grid** packages the grid resource directory as a `.tar.gz` archive.

| File | Contents |
|---|---|
| `ne.txt` | Scenario computational cells: 1-based ID, edge counts in west/east/south/north order, corresponding edge IDs, centre coordinates, elevation, and LULC. |
| `ns.txt` | Scenario edges: 1-based ID, direction (`1` horizontal, `2` vertical), left/right/bottom/top adjacent cell IDs (`0` for an absent neighbour), length, midpoint coordinates, elevation, and LULC. |
| `cell_topo.bin` | Internal base-grid cell geometry, connectivity, and sampled base attributes; retained for derivation. |
| `edge_topo.bin` | Internal base-grid edge geometry, adjacency, and sampled base attributes; retained for derivation. |
| `grid.meta.json` | Grid coordinate reference system, bounds, grid levels, subdivision rules, alignment origin, and recorded raster-source paths. |
| `build_report.json` | Assembly or base-grid reference, cell/edge counts, intervention selection counts, and stage timings. |

Base binaries describe the base grid; scenario elevation and LULC changes appear in `ne.txt` and `ns.txt`. Metadata and reports may contain local source paths; review exported archives and data permissions before sharing them.

## Development structure

The renderer uses React and TypeScript with Vite. Its reusable UI components are in `client/src/src/components/ui/`, using shadcn/ui and Radix UI, with Tailwind CSS for styling and Lucide React for icons. Map views use Mapbox GL JS; the Three.js and `3d-tiles-renderer` code is in `client/src/src/threejs/`.

Resource templates are in `client/src/src/template/`, view implementations in `client/src/src/views/`, and grid-editing logic in `client/src/src/core/grid/`. The resource tree, tabs, and navigation components are in `client/src/src/components/`. Zustand stores are defined in `client/src/src/store/storeSet.ts`, including settings persisted in localStorage; `client/src/src/store/store.ts` provides a separate in-memory store for transient state. The backend serves grid operations through FastAPI.

## Repository and license

```text
client/electron/      Electron shell
client/src/           React/Vite renderer and its package.json
server/main.py        Backend launch entry point
server/src/           FastAPI endpoints, schemas, and settings
server/templates/     Resource lifecycle hooks, assembly, interventions
server/crms/          Resource implementations
server/icrms/         Resource interfaces
server/tests/         Backend tests
scripts/              Setup, launch, diagnostics, benchmark analysis
docs/benchmark/       Patch rendering and edit-latency measurement guide
templates/            Generated renderer build (ignored)
server/resource/      Local resources (ignored)
```

Gridmen is released under the [MIT License](LICENSE).
