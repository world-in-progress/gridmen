import os
import sys
import json
import types
import struct
from importlib import import_module
from pathlib import Path

import numpy as np
import pytest

SERVER_ROOT = Path(__file__).resolve().parents[3]
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

templates_pkg = types.ModuleType("templates")
templates_pkg.__path__ = [str(SERVER_ROOT / "templates")]
sys.modules.setdefault("templates", templates_pkg)

templates_grid_pkg = types.ModuleType("templates.grid")
templates_grid_pkg.__path__ = [str(SERVER_ROOT / "templates" / "grid")]
sys.modules.setdefault("templates.grid", templates_grid_pkg)

assembly = import_module("templates.grid.assembly")
vector = import_module("templates.grid.vector")
hooks = import_module("templates.grid.hooks")

# Two 4 m cells side by side: cell 1 [0, 4] x [0, 4], cell 2 [4, 8] x [0, 4].
CELLS = [
    # bounds, altitude, lum, 0-based edge indices indexed by EdgeCode (north, west, south, east)
    ((0.0, 0.0, 4.0, 4.0), 1.0, 3, [[3], [0], [2], [1]]),
    ((4.0, 0.0, 8.0, 4.0), 2.0, 4, [[6], [1], [5], [4]]),
]
EDGES = [
    # direction (0 vertical, 1 horizontal), bounds, (cell_a, cell_b) 0-based or None, altitude, lum
    (0, (0.0, 0.0, 0.0, 4.0), (None, 0), 1.5, 3),
    (0, (4.0, 0.0, 4.0, 4.0), (0, 1), 1.75, 3),
    (1, (0.0, 0.0, 4.0, 0.0), (0, None), 1.25, 3),
    (1, (0.0, 4.0, 4.0, 4.0), (None, 0), 1.0, 3),
    (0, (8.0, 0.0, 8.0, 4.0), (1, None), 2.5, 4),
    (1, (4.0, 0.0, 8.0, 0.0), (1, None), 2.25, 4),
    (1, (4.0, 4.0, 8.0, 4.0), (None, 1), 2.0, 4),
]
CRS = 2326


def _write_base_grid(grid_dir: Path, *, cells=CELLS, edges=EDGES, meta=None):
    grid_dir.mkdir(parents=True, exist_ok=True)
    with open(grid_dir / "cell_topo.bin", "wb") as f:
        for i, (bounds, altitude, lum, cell_edges) in enumerate(cells):
            record = assembly._generate_cell_record_from_geometry(i, *bounds, cell_edges, altitude, lum)
            f.write(struct.pack("!I", len(record)) + record)
    with open(grid_dir / "edge_topo.bin", "wb") as f:
        for i, (direction, bounds, adjacent_cells, altitude, lum) in enumerate(edges):
            record = assembly._generate_edge_record_from_geometry(i, direction, *bounds, list(adjacent_cells), altitude, lum)
            f.write(struct.pack("!I", len(record)) + record)
    (grid_dir / "grid.meta.json").write_text(json.dumps({"epsg": CRS, **(meta or {})}), encoding="utf-8")


def _write_vector(root: Path, name: str, geometry: dict):
    vector_dir = root / "resource" / "v" / name
    vector_dir.mkdir(parents=True, exist_ok=True)
    feature = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {}, "geometry": geometry}]}
    (vector_dir / f"{name}.geojson").write_text(json.dumps(feature), encoding="utf-8")
    (vector_dir / "meta.json").write_text(json.dumps({"name": name, "epsg": str(CRS)}), encoding="utf-8")
    return f".v.{name}"


def _square(x0, y0, x1, y1):
    return {"type": "Polygon", "coordinates": [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]}


def _apply(tmp_path, interventions):
    _write_base_grid(tmp_path / "grid")
    grid = vector.load_base_grid(tmp_path / "grid")
    stats = vector.apply_interventions(grid, vector.load_interventions(interventions), f"EPSG:{CRS}")
    return grid, stats


@pytest.fixture(autouse=True)
def _in_tmp(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)


def test_ne_ns_text_layout(tmp_path):
    grid, _ = _apply(tmp_path, [])
    vector.write_ne(tmp_path / "ne.txt", grid)
    vector.write_ns(tmp_path / "ns.txt", grid)

    assert (tmp_path / "ne.txt").read_text(encoding="utf-8").splitlines() == [
        "1, 1, 1, 1, 1, 1, 2, 3, 4, 2, 2, 1, 3",
        "2, 1, 1, 1, 1, 2, 5, 6, 7, 6, 2, 2, 4",
    ]
    assert (tmp_path / "ns.txt").read_text(encoding="utf-8").splitlines() == [
        "1, 2, 0, 1, 0, 0, 4, 0, 2, 1.5, 3",
        "2, 2, 1, 2, 0, 0, 4, 4, 2, 1.75, 3",
        "3, 1, 0, 0, 0, 1, 4, 2, 0, 1.25, 3",
        "4, 1, 0, 0, 1, 0, 4, 2, 4, 1, 3",
        "5, 2, 2, 0, 0, 0, 4, 8, 2, 2.5, 4",
        "6, 1, 0, 0, 0, 2, 4, 6, 0, 2.25, 4",
        "7, 1, 0, 0, 2, 0, 4, 6, 4, 2, 4",
    ]


def test_polygon_selects_cell_centres_and_edge_midpoints_with_one_operation(tmp_path):
    pond = _write_vector(tmp_path, "pond", _square(-1.0, -1.0, 3.0, 5.0))
    grid, stats = _apply(tmp_path, [{"node_key": pond, "dem": {"type": "subtract", "value": 5}, "lum": {"type": "set", "value": 10}}])

    assert grid.cell_z.tolist() == [-4.0, 2.0]
    assert grid.cell_type.tolist() == [10, 4]
    # West, south and north edges of cell 1 have midpoints inside; the shared edge at x=4 does not.
    assert grid.edge_z.tolist() == [-3.5, 1.75, -3.75, -4.0, 2.5, 2.25, 2.0]
    assert grid.edge_type.tolist() == [10, 3, 10, 10, 4, 4, 4]
    assert (stats[0]["cells"], stats[0]["edges"]) == (1, 3)


def test_line_selects_only_the_cells_and_edges_it_passes_through(tmp_path):
    inside_cell_1 = _write_vector(tmp_path, "short", {"type": "LineString", "coordinates": [[1.0, 1.0], [2.0, 3.0]]})
    across = _write_vector(tmp_path, "across", {"type": "LineString", "coordinates": [[1.0, 2.0], [6.0, 2.0]]})

    grid, _ = _apply(tmp_path, [{"node_key": inside_cell_1, "dem": {"type": "set", "value": 9}}])
    assert grid.cell_z.tolist() == [9.0, 2.0]
    assert grid.edge_z.tolist() == [1.5, 1.75, 1.25, 1.0, 2.5, 2.25, 2.0]

    grid, _ = _apply(tmp_path, [{"node_key": across, "dem": {"type": "set", "value": 9}}])
    assert grid.cell_z.tolist() == [9.0, 9.0]
    assert grid.edge_z.tolist() == [1.5, 9.0, 1.25, 1.0, 2.5, 2.25, 2.0]


def test_point_selects_the_cell_containing_it(tmp_path):
    gauge = _write_vector(tmp_path, "gauge", {"type": "Point", "coordinates": [6.0, 1.0]})
    grid, _ = _apply(tmp_path, [{"node_key": gauge, "lum": {"type": "set", "value": 7}}])

    assert grid.cell_type.tolist() == [3, 7]
    assert grid.edge_type.tolist() == [3, 3, 3, 3, 4, 4, 4]


def test_interventions_apply_in_order_and_max_flattens_to_highest_cell(tmp_path):
    everything = _write_vector(tmp_path, "everything", _square(-1.0, -1.0, 9.0, 5.0))
    right = _write_vector(tmp_path, "right", _square(5.0, -1.0, 9.0, 5.0))

    grid, _ = _apply(tmp_path, [
        {"node_key": everything, "dem": {"type": "add", "value": 1}},
        {"node_key": right, "dem": {"type": "set", "value": 0}},
    ])
    assert grid.cell_z.tolist() == [2.0, 0.0]

    grid, _ = _apply(tmp_path, [{"node_key": everything, "dem": {"type": "max"}}])
    assert grid.cell_z.tolist() == [2.0, 2.0]
    assert set(grid.edge_z.tolist()) == {2.0}


@pytest.mark.parametrize("item, message", [
    ({"node_key": ".v.pond", "dem": {"type": "set", "value": None}}, "needs a finite number"),
    ({"node_key": ".v.pond", "dem": {"type": "raise", "value": 1}}, "unknown DEM operation"),
    ({"node_key": ".v.pond", "lum": {"type": "set", "value": 256}}, "integer in 0-255"),
    ({"node_key": ".v.pond"}, "neither DEM nor LULC"),
    ({"node_key": ".v.missing", "dem": {"type": "set", "value": 1}}, "has no .geojson"),
])
def test_invalid_interventions_are_rejected(tmp_path, item, message):
    _write_vector(tmp_path, "pond", _square(0.0, 0.0, 1.0, 1.0))
    with pytest.raises(ValueError, match=message):
        vector.load_interventions([item])


def _read(path: Path) -> bytes:
    return path.read_bytes()


def test_grid_from_base_grid_reuses_binaries_and_reproduces_scenarios(tmp_path):
    _write_base_grid(tmp_path / "resource" / "g" / "base")
    base_files = {name: _read(tmp_path / "resource" / "g" / "base" / name) for name in ("cell_topo.bin", "edge_topo.bin")}
    pond = _write_vector(tmp_path, "pond", _square(-1.0, -1.0, 3.0, 5.0))
    scenario_a = [{"node_key": pond, "dem": {"type": "subtract", "value": 5}}]
    scenario_b = [{"node_key": pond, "dem": {"type": "subtract", "value": 2}}]

    hooks.MOUNT(".g.a", {"base_grid": ".g.base", "vector": scenario_a})
    hooks.MOUNT(".g.b", {"base_grid": ".g.a", "vector": scenario_b})
    hooks.MOUNT(".g.a2", {"base_grid": ".g.b", "vector": scenario_a})

    grids = {name: tmp_path / "resource" / "g" / name for name in ("base", "a", "b", "a2")}
    for name in ("cell_topo.bin", "edge_topo.bin"):
        assert _read(grids["base"] / name) == base_files[name]
        assert os.path.samefile(grids["base"] / name, grids["a2"] / name)
    for name in ("ne.txt", "ns.txt"):
        assert _read(grids["a"] / name) == _read(grids["a2"] / name)
        assert _read(grids["a"] / name) != _read(grids["b"] / name)

    report = json.loads((grids["a"] / "build_report.json").read_text(encoding="utf-8"))
    assert report["base"] == {"base_grid": ".g.base"}
    assert (report["cells"], report["edges"]) == (2, 7)
    assert report["interventions"][0]["cells"] == 1
    assert {"MOUNT", "grid.base", "grid.interventions"} <= {s["stage"] for s in report["stages"]}


@pytest.mark.parametrize("params", [
    {"vector": []},
    {"assembly": {"schema_node_key": ".s", "patch_node_keys": [".p"]}, "base_grid": ".g.base"},
])
def test_grid_needs_exactly_one_base(tmp_path, params):
    with pytest.raises(ValueError, match="exactly one base"):
        hooks.MOUNT(".g.new", params)


def test_base_grid_must_exist(tmp_path):
    with pytest.raises(ValueError, match="has no cell_topo.bin"):
        hooks.MOUNT(".g.new", {"base_grid": ".g.absent", "vector": []})


def _crest_dem(tmp_path, *, ridge_y=2.25, nodata=False, crs=CRS, transform=None):
    # 0.5 m pixels; pixel centres range from -31.75 to 63.75.
    data = np.ones((192, 192), dtype=np.float32)
    data[int((64 - ridge_y) / 0.5), :] = 7
    if nodata:
        data[:] = -9999
    path = tmp_path / 'dem.tif'
    with vector.rasterio.open(
        path, 'w', driver='GTiff', height=192, width=192, count=1,
        dtype=data.dtype, crs=f'EPSG:{crs}', nodata=-9999,
        transform=transform or vector.rasterio.transform.from_origin(-32, 64, 0.5, 0.5),
    ) as dst:
        dst.write(data, 1)
    return path


def _crest_intervention(tmp_path, coords=None):
    key = _write_vector(tmp_path, 'crest', {
        'type': 'LineString', 'coordinates': coords or [[0.5, 1], [7.5, 1]],
    })
    return {'node_key': key, 'dem': {'type': 'crest'}}


def _run_crest(tmp_path, item, dem_path, *, finest=4):
    grid = vector.load_base_grid(tmp_path / 'grid')
    stats = vector.apply_interventions(
        grid, vector.load_interventions([item]), f'EPSG:{CRS}',
        dem_path=dem_path, finest_cell_size=finest,
    )
    return grid, stats


@pytest.mark.parametrize('size, finest, ridge_y', [(4, 4, 2.25), (16, 16, 8.25), (16, 4, 2.25)])
def test_crest_retains_offset_ridge_at_fine_and_coarse_resolution(tmp_path, size, finest, ridge_y):
    cells = [((x, 0, x + size, size), z, lum, edges) for x, (_, z, lum, edges) in zip(
        [0, size], CELLS,
    )]
    edges = [(direction, tuple(v * size / 4 for v in bounds), pair, z, lum)
             for direction, bounds, pair, z, lum in EDGES]
    _write_base_grid(tmp_path / 'grid', cells=cells, edges=edges)
    item = _crest_intervention(tmp_path, [[0.5, 1], [2 * size - 0.5, 1]])
    grid, stats = _run_crest(tmp_path, item, _crest_dem(tmp_path, ridge_y=ridge_y), finest=finest)
    assert grid.cell_z.tolist() == [7, 7]
    assert grid.edge_z[1] == 7  # Shared edge, crossed by the line.
    assert grid.edge_z[0] == 1.5  # Uncrossed edge retains its base elevation.
    assert (stats[0]['cells'], stats[0]['edges']) == (2, 1)


@pytest.mark.parametrize('size, finest, ridge_y', [(4, 4, 3.25), (16, 16, 9.25), (16, 4, 3.25)])
def test_crest_excludes_ridge_beyond_footprint_even_in_coarse_cells(tmp_path, size, finest, ridge_y):
    # The ridge is inside the cell, but 0.25 m beyond the corridor radius.
    cells = [((0, 0, size, size), 0, 3, [[], [], [], []])]
    _write_base_grid(tmp_path / 'grid', cells=cells, edges=[])
    item = _crest_intervention(tmp_path, [[0.5, 1], [size - 0.5, 1]])
    grid, _ = _run_crest(tmp_path, item, _crest_dem(tmp_path, ridge_y=ridge_y), finest=finest)
    assert grid.cell_z.tolist() == [1]


def test_crest_mixed_levels_protects_crossed_split_edge(tmp_path):
    cells = [((0, 0, 16, 16), 0, 3, [[], [], [], [0, 1, 2, 3]])]
    cells += [((16, y, 20, y + 4), 0, 3, [[], [i], [], []]) for i, y in enumerate(range(0, 16, 4))]
    edges = [(0, (16, y, 16, y + 4), (0, i + 1), 0, 3) for i, y in enumerate(range(0, 16, 4))]
    _write_base_grid(tmp_path / 'grid', cells=cells, edges=edges)
    item = _crest_intervention(tmp_path, [[1, 1], [19, 1]])
    grid, _ = _run_crest(tmp_path, item, _crest_dem(tmp_path))
    assert grid.cell_z.tolist() == [7, 7, 0, 0, 0]
    assert grid.edge_z.tolist() == [7, 0, 0, 0]


def test_crest_along_split_edges_uses_higher_adjacent_cell_crest(tmp_path):
    cells = [((0, 0, 16, 16), 0, 3, [[], [], [], [0, 1, 2, 3]])]
    cells += [((16, y, 20, y + 4), 0, 3, [[], [i], [], []]) for i, y in enumerate(range(0, 16, 4))]
    edges = [(0, (16, y, 16, y + 4), (0, i + 1), 0, 3) for i, y in enumerate(range(0, 16, 4))]
    _write_base_grid(tmp_path / 'grid', cells=cells, edges=edges)
    path = _crest_dem(tmp_path)
    with vector.rasterio.open(path, 'r+') as dst:
        data = np.ones((192, 192), dtype=np.float32)
        data[:, int((17.25 + 32) / 0.5)] = 7
        dst.write(data, 1)
    item = _crest_intervention(tmp_path, [[16, 0.5], [16, 15.5]])
    grid, _ = _run_crest(tmp_path, item, path)
    assert grid.cell_z.tolist() == [1, 7, 7, 7, 7]
    assert grid.edge_z.tolist() == [7, 7, 7, 7]


def test_crest_diagonal_corridor_uses_distance_not_its_bounding_box(tmp_path):
    _write_base_grid(tmp_path / 'grid')
    path = _crest_dem(tmp_path, nodata=True)
    with vector.rasterio.open(path, 'r+') as dst:
        data = np.ones((192, 192), dtype=np.float32)
        data[int((64 - 0.25) / 0.5), int((3.75 + 32) / 0.5)] = 99
        dst.write(data, 1)
    item = _crest_intervention(tmp_path, [[0, 0], [4, 4]])
    grid, _ = _run_crest(tmp_path, item, path)
    assert grid.cell_z.tolist() == [1, 1]


def test_crest_uses_each_cell_footprint_and_never_lowers_crossed_edge(tmp_path):
    _write_base_grid(tmp_path / 'grid')
    path = _crest_dem(tmp_path)
    with vector.rasterio.open(path, 'r+') as dst:
        data = dst.read(1)
        data[int((64 - 2.25) / 0.5), int((4 + 32) / 0.5):] = 9
        dst.write(data, 1)
    item = _crest_intervention(tmp_path)
    grid, _ = _run_crest(tmp_path, item, path)
    assert grid.cell_z.tolist() == [7, 9]
    assert grid.edge_z[1] == 9
    grid.edge_z[1] = 12
    vector.apply_interventions(grid, vector.load_interventions([item]), f'EPSG:{CRS}', dem_path=path, finest_cell_size=4)
    assert grid.edge_z[1] == 12


@pytest.mark.parametrize('geometry', [
    _square(0, 0, 4, 4), {'type': 'Point', 'coordinates': [1, 1]},
])
def test_crest_rejects_non_line_geometry_at_load(tmp_path, geometry):
    key = _write_vector(tmp_path, 'invalid', geometry)
    with pytest.raises(ValueError, match='crest only supports line'):
        vector.load_interventions([{'node_key': key, 'dem': {'type': 'crest'}}])


def test_crest_rejects_all_nodata_footprint(tmp_path):
    _write_base_grid(tmp_path / 'grid')
    item = _crest_intervention(tmp_path)
    with pytest.raises(ValueError, match='footprint has no valid DEM pixels'):
        _run_crest(tmp_path, item, _crest_dem(tmp_path, nodata=True))


def test_crest_requires_full_footprint_coverage(tmp_path):
    _write_base_grid(tmp_path / 'grid')
    item = _crest_intervention(tmp_path, [[-31, 1], [7, 1]])
    with pytest.raises(ValueError, match='DEM must cover the entire line footprint'):
        _run_crest(tmp_path, item, _crest_dem(tmp_path))


@pytest.mark.parametrize('crs, transform', [
    (4326, None), (CRS, vector.rasterio.Affine(0.5, 0.1, -32, 0, -0.5, 64)),
])
def test_crest_rejects_incompatible_dem_at_boundary(tmp_path, crs, transform):
    _write_base_grid(tmp_path / 'grid')
    item = _crest_intervention(tmp_path)
    with pytest.raises(ValueError, match='grid CRS and a north-up'):
        _run_crest(tmp_path, item, _crest_dem(tmp_path, crs=crs, transform=transform))


def test_crest_from_derived_grid_uses_original_dem_and_only_local_windows(tmp_path, monkeypatch):
    base = tmp_path / 'resource/g/base'
    path = _crest_dem(tmp_path)
    meta = {'dem_path': str(path), 'grid_info': [[16, 16], [4, 4]]}
    _write_base_grid(base, meta=meta)
    before = {name: (base / name).read_bytes() for name in hooks.BASE_GRID_FILES}
    item = _crest_intervention(tmp_path)
    hooks.MOUNT('.g.derived', {'base_grid': '.g.base'})
    windows, opens = [], []
    real_open = vector.rasterio.open

    class RecordingRaster:
        def __enter__(self):
            self.src = real_open(path)
            return self

        def __exit__(self, *args):
            self.src.close()

        def __getattr__(self, name):
            return getattr(self.src, name)

        def read(self, band, *, window, masked):
            windows.append(window)
            return self.src.read(band, window=window, masked=masked)

    def recording_open(source):
        opens.append(source)
        return RecordingRaster()

    monkeypatch.setattr(vector.rasterio, 'open', recording_open)
    hooks.MOUNT('.g.crest', {'base_grid': '.g.derived', 'vector': [item, item]})
    assert opens == [str(path)]
    assert windows and all(w.width <= 8 and w.height <= 6 for w in windows)
    target = tmp_path / 'resource/g/crest'
    assert json.loads((target / 'grid.meta.json').read_text())['dem_path'] == str(path)
    assert [float(line.split(', ')[-2]) for line in (target / 'ne.txt').read_text().splitlines()] == [7, 7]
    assert float((target / 'ns.txt').read_text().splitlines()[1].split(', ')[-2]) == 7
    for name in hooks.BASE_GRID_FILES:
        assert (base / name).read_bytes() == before[name]
        assert os.path.samefile(base / name, target / name)


def test_crest_without_base_dem_provenance_fails(tmp_path):
    _write_base_grid(tmp_path / 'resource/g/base', meta={'grid_info': [[4, 4]]})
    item = _crest_intervention(tmp_path)
    with pytest.raises(ValueError, match='base grid DEM provenance'):
        hooks.MOUNT('.g.crest', {'base_grid': '.g.base', 'vector': [item]})


def test_assembly_records_dem_used_for_sampling_and_crest(tmp_path, monkeypatch):
    path = _crest_dem(tmp_path)
    schema = tmp_path / 'resource/s/schema'
    schema.mkdir(parents=True)
    (schema / 'schema.json').write_text(json.dumps({
        'epsg': CRS, 'grid_info': [[4, 4]], 'alignment_origin': [0, 0],
    }))
    monkeypatch.setattr(assembly, '_get_bounds', lambda paths: [0, 0, 8, 4])

    def activate(keys, *args):
        keys.update([struct.pack('!BQ', 1, 0), struct.pack('!BQ', 1, 1)])

    class InlinePool:
        def __init__(self, processes):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def imap(self, func, args):
            return map(func, args)

    # Exercise real assembly/topology/sampling; replace patch RPC and process launch only.
    monkeypatch.setattr(assembly, '_update_cells_by_patch', activate)
    monkeypatch.setattr(assembly.mp, 'Pool', InlinePool)
    item = _crest_intervention(tmp_path)
    hooks.MOUNT('.g.assembled', {
        'assembly': {'schema_node_key': '.s.schema', 'patch_node_keys': ['.p.patch'], 'dem_path': 'dem.tif'},
        'vector': [item],
    })
    target = tmp_path / 'resource/g/assembled'
    assert json.loads((target / 'grid.meta.json').read_text())['dem_path'] == str(path.resolve())
    base = vector.load_base_grid(target)
    assert base.cell_z.tolist() == [1.75, 1.75]  # Base DEM means remain intact.
    assert [float(line.split(', ')[-2]) for line in (target / 'ne.txt').read_text().splitlines()] == [7, 7]


def test_crest_requires_valid_pixels_in_each_selected_cell(tmp_path):
    _write_base_grid(tmp_path / 'grid')
    path = _crest_dem(tmp_path)
    with vector.rasterio.open(path, 'r+') as dst:
        data = dst.read(1)
        # The right cell has valid DEM outside the corridor, but none in it.
        data[int((64 - 3) / 0.5):int((64 - 0) / 0.5), int((4 + 32) / 0.5):int((8 + 32) / 0.5)] = -9999
        dst.write(data, 1)
    with pytest.raises(ValueError, match='footprint has no valid DEM pixels'):
        _run_crest(tmp_path, _crest_intervention(tmp_path), path)


def test_crest_multiline_round_caps_and_inclusive_corridor_boundary(tmp_path):
    _write_base_grid(tmp_path / 'grid')
    path = _crest_dem(tmp_path, nodata=True)
    with vector.rasterio.open(path, 'r+') as dst:
        data = np.ones((192, 192), dtype=np.float32)
        # Exactly 2 m from y=1.25: included. Outside the end cap: excluded.
        data[int((64 - 3.25) / 0.5), int((1.25 + 32) / 0.5)] = 7
        data[int((64 - 1.25) / 0.5), int((7.75 + 32) / 0.5)] = 99
        dst.write(data, 1)
    key = _write_vector(tmp_path, 'multi', {'type': 'MultiLineString', 'coordinates': [
        [[0.25, 1.25], [1.25, 1.25]], [[4.25, 1.25], [5.25, 1.25]],
    ]})
    grid, _ = _run_crest(tmp_path, {'node_key': key, 'dem': {'type': 'crest'}}, path)
    assert grid.cell_z.tolist() == [7, 1]
