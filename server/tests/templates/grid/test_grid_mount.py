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


def _write_base_grid(grid_dir: Path):
    grid_dir.mkdir(parents=True, exist_ok=True)
    with open(grid_dir / "cell_topo.bin", "wb") as f:
        for i, (bounds, altitude, lum, edges) in enumerate(CELLS):
            record = assembly._generate_cell_record_from_geometry(i, *bounds, edges, altitude, lum)
            f.write(struct.pack("!I", len(record)) + record)
    with open(grid_dir / "edge_topo.bin", "wb") as f:
        for i, (direction, bounds, cells, altitude, lum) in enumerate(EDGES):
            record = assembly._generate_edge_record_from_geometry(i, direction, *bounds, list(cells), altitude, lum)
            f.write(struct.pack("!I", len(record)) + record)
    (grid_dir / "grid.meta.json").write_text(json.dumps({"epsg": CRS}), encoding="utf-8")


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
