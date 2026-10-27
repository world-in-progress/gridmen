"""Vector interventions on a base grid, and the solver-facing ne.txt / ns.txt files.

A grid keeps its base attributes (DEM/LULC sampled from the source rasters) in
cell_topo.bin and edge_topo.bin. The solver input is always computed from those
binaries plus the grid's ordered vector interventions, so interventions never
compound and the binaries are never modified.

Selection rule (which cells and edges an intervention acts on):
  - Polygon / MultiPolygon: cells whose centre and edges whose midpoint lie inside.
  - LineString / MultiLineString: cells and edges the line passes through or touches.
  - Point / MultiPoint: cells and edges that contain the point.
Interventions apply in list order; a later one overrides an earlier one where they overlap.
Cells and edges always receive the same operation.
"""
import json
import os
import struct
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from pyproj import Transformer

from ._timing import timed

ELEVATION_OPS = ('set', 'add', 'subtract', 'max')

# edge_topo.bin record: uint32 length prefix + '!QBddddQQdi'
EDGE_RECORD = np.dtype([
    ('length', '>u4'), ('index', '>u8'), ('direction', 'u1'),
    ('x_min', '>f8'), ('y_min', '>f8'), ('x_max', '>f8'), ('y_max', '>f8'),
    ('cell_a', '>u8'), ('cell_b', '>u8'), ('altitude', '>f8'), ('type', '>i4'),
])
_CELL_HEADER = struct.Struct('!QdddddBBBBB')


@dataclass
class BaseGrid:
    """Base grid arrays read from cell_topo.bin / edge_topo.bin. z and type are working copies."""
    cell_index: np.ndarray        # (n,) 1-based ids
    cell_bounds: np.ndarray       # (n, 4) x_min, y_min, x_max, y_max
    cell_edge_counts: np.ndarray  # (n, 4) west, east, south, north
    cell_edge_ids: np.ndarray     # flat 1-based edge ids, per cell in west, east, south, north order
    cell_z: np.ndarray
    cell_type: np.ndarray
    edges: np.ndarray             # EDGE_RECORD array
    edge_z: np.ndarray
    edge_type: np.ndarray

    @property
    def cell_centres(self) -> tuple[np.ndarray, np.ndarray]:
        b = self.cell_bounds
        return (b[:, 0] + b[:, 2]) / 2.0, (b[:, 1] + b[:, 3]) / 2.0

    @property
    def edge_midpoints(self) -> tuple[np.ndarray, np.ndarray]:
        e = self.edges
        return (e['x_min'] + e['x_max']) / 2.0, (e['y_min'] + e['y_max']) / 2.0


def load_base_grid(grid_dir: Path) -> BaseGrid:
    data = (Path(grid_dir) / 'cell_topo.bin').read_bytes()
    index, bounds, z, types, counts, edge_ids = [], [], [], [], [], []
    offset, size = 0, len(data)
    while offset < size:
        (length,) = struct.unpack_from('!I', data, offset)
        record = offset + 4
        idx, x0, y0, x1, y1, altitude, cell_type, west, east, south, north = _CELL_HEADER.unpack_from(data, record)
        n_edges = west + east + south + north
        index.append(idx)
        bounds.append((x0, y0, x1, y1))
        z.append(altitude)
        types.append(cell_type)
        counts.append((west, east, south, north))
        edge_ids.extend(struct.unpack_from(f'!{n_edges}Q', data, record + _CELL_HEADER.size))
        offset = record + length

    edges = np.fromfile(Path(grid_dir) / 'edge_topo.bin', dtype=EDGE_RECORD)
    return BaseGrid(
        cell_index=np.asarray(index, dtype=np.int64),
        cell_bounds=np.asarray(bounds, dtype=np.float64).reshape(-1, 4),
        cell_edge_counts=np.asarray(counts, dtype=np.int64).reshape(-1, 4),
        cell_edge_ids=np.asarray(edge_ids, dtype=np.int64),
        cell_z=np.asarray(z, dtype=np.float64),
        cell_type=np.asarray(types, dtype=np.int64),
        edges=edges,
        edge_z=edges['altitude'].astype(np.float64),
        edge_type=edges['type'].astype(np.int64),
    )


# ==================== Interventions ====================

@dataclass(frozen=True)
class Intervention:
    node_key: str
    crs: str                                   # CRS of the vector resource
    polygons: list[tuple[np.ndarray, list[np.ndarray]]]
    lines: list[np.ndarray]
    points: np.ndarray                         # (k, 2)
    dem: tuple[str, float | None] | None       # (op, value); value is None only for 'max'
    lum: int | None                            # LULC class to set


def load_interventions(raw: list) -> list[Intervention]:
    """Validate the grid's 'vector' mount parameter and load the referenced vector resources."""
    if not isinstance(raw, list):
        raise ValueError("'vector' must be a list of interventions")
    return [_load_intervention(item, i) for i, item in enumerate(raw)]


def _load_intervention(item: dict, position: int) -> Intervention:
    where = f'vector[{position}]'
    if not isinstance(item, dict) or not isinstance(item.get('node_key'), str):
        raise ValueError(f'{where}: an intervention needs a vector node_key')
    node_key = item['node_key']

    dem = None
    if item.get('dem') is not None:
        op, value = item['dem'].get('type'), item['dem'].get('value')
        if op not in ELEVATION_OPS:
            raise ValueError(f'{where} ({node_key}): unknown DEM operation {op!r}, expected one of {ELEVATION_OPS}')
        if op == 'max':
            value = None
        elif not isinstance(value, (int, float)) or isinstance(value, bool) or not np.isfinite(value):
            raise ValueError(f'{where} ({node_key}): DEM operation {op!r} needs a finite number')
        dem = (op, None if value is None else float(value))

    lum = None
    if item.get('lum') is not None:
        op, value = item['lum'].get('type'), item['lum'].get('value')
        if op != 'set':
            raise ValueError(f"{where} ({node_key}): LULC only supports 'set', got {op!r}")
        if not isinstance(value, (int, float)) or isinstance(value, bool) or not float(value).is_integer() or not 0 <= value <= 255:
            raise ValueError(f'{where} ({node_key}): LULC class must be an integer in 0-255, got {value!r}')
        lum = int(value)

    if dem is None and lum is None:
        raise ValueError(f'{where} ({node_key}): the intervention sets neither DEM nor LULC')

    resource_dir = Path.cwd() / 'resource' / node_key.strip('.').replace('.', os.sep)
    geojson_files = sorted(resource_dir.glob('*.geojson'))
    if not geojson_files:
        raise ValueError(f'{where}: vector resource {node_key} has no .geojson file in {resource_dir}')
    feature = json.loads(geojson_files[0].read_text(encoding='utf-8'))
    meta = json.loads((resource_dir / 'meta.json').read_text(encoding='utf-8'))
    epsg = meta['epsg']

    polygons, lines, points = [], [], []
    for geometry in _geometries(feature):
        kind, coords = geometry['type'], geometry['coordinates']
        if kind == 'Polygon':
            polygons.append(_polygon(coords))
        elif kind == 'MultiPolygon':
            polygons.extend(_polygon(c) for c in coords)
        elif kind == 'LineString':
            lines.append(_line(coords))
        elif kind == 'MultiLineString':
            lines.extend(_line(c) for c in coords)
        elif kind == 'Point':
            points.append(coords[:2])
        elif kind == 'MultiPoint':
            points.extend(c[:2] for c in coords)
        else:
            raise ValueError(f'{where}: vector {node_key} has unsupported geometry type {kind!r}')

    return Intervention(
        node_key=node_key,
        crs=f'EPSG:{epsg}' if str(epsg).isdigit() else str(epsg),
        polygons=polygons,
        lines=lines,
        points=np.asarray(points, dtype=np.float64).reshape(-1, 2),
        dem=dem,
        lum=lum,
    )


def _geometries(feature: dict):
    if feature.get('type') == 'FeatureCollection':
        for f in feature['features']:
            yield from _geometries(f)
    elif feature.get('type') == 'Feature':
        if feature['geometry'] is not None:
            yield feature['geometry']
    else:
        yield feature


def _ring(coords) -> np.ndarray:
    ring = np.asarray(coords, dtype=np.float64)[:, :2]
    if len(ring) >= 2 and np.array_equal(ring[0], ring[-1]):
        ring = ring[:-1]
    return ring


def _polygon(coords) -> tuple[np.ndarray, list[np.ndarray]]:
    return _ring(coords[0]), [_ring(hole) for hole in coords[1:]]


def _line(coords) -> np.ndarray:
    return np.asarray(coords, dtype=np.float64)[:, :2]


def apply_interventions(grid: BaseGrid, interventions: list[Intervention], grid_crs: str) -> list[dict]:
    """Apply interventions in order to grid.cell_z/cell_type/edge_z/edge_type. Returns per-intervention counts."""
    cx, cy = grid.cell_centres
    ex, ey = grid.edge_midpoints
    cell_boxes = edge_boxes = None
    stats = []

    for item in interventions:
        with timed('vector.intervention', node_key=item.node_key):
            polygons, lines, points = _to_grid_crs(item, grid_crs)
            cell_sel = np.zeros(cx.shape[0], dtype=bool)
            edge_sel = np.zeros(ex.shape[0], dtype=bool)
            if polygons:
                cell_sel |= _polygons_mask(cx, cy, polygons)
                edge_sel |= _polygons_mask(ex, ey, polygons)
            if lines or len(points):
                if cell_boxes is None:
                    cell_boxes = _BoxIndex(grid.cell_bounds)
                    e = grid.edges
                    edge_boxes = _BoxIndex(np.column_stack([e['x_min'], e['y_min'], e['x_max'], e['y_max']]))
                for line in lines:
                    for (ax, ay), (bx, by) in zip(line[:-1], line[1:]):
                        cell_sel[cell_boxes.hit_segment(ax, ay, bx, by)] = True
                        edge_sel[edge_boxes.hit_segment(ax, ay, bx, by)] = True
                for px, py in points:
                    cell_sel[cell_boxes.hit_segment(px, py, px, py)] = True
                    edge_sel[edge_boxes.hit_segment(px, py, px, py)] = True

            if item.dem is not None:
                op, value = item.dem
                if op == 'max':
                    # Flatten the selection to the highest selected cell elevation.
                    value = float(grid.cell_z[cell_sel].max()) if cell_sel.any() else None
                if value is not None:
                    for z, sel in ((grid.cell_z, cell_sel), (grid.edge_z, edge_sel)):
                        if op in ('set', 'max'):
                            z[sel] = value
                        elif op == 'add':
                            z[sel] += value
                        else:
                            z[sel] -= value
            if item.lum is not None:
                grid.cell_type[cell_sel] = item.lum
                grid.edge_type[edge_sel] = item.lum

            stats.append({
                'node_key': item.node_key,
                'dem': None if item.dem is None else {'type': item.dem[0], 'value': item.dem[1]},
                'lum': item.lum,
                'cells': int(cell_sel.sum()),
                'edges': int(edge_sel.sum()),
            })
    return stats


def _to_grid_crs(item: Intervention, grid_crs: str):
    if item.crs == grid_crs:
        return item.polygons, item.lines, item.points
    transformer = Transformer.from_crs(item.crs, grid_crs, always_xy=True)

    def tf(xy: np.ndarray) -> np.ndarray:
        if len(xy) == 0:
            return xy
        x, y = transformer.transform(xy[:, 0], xy[:, 1])
        return np.column_stack([x, y])

    return (
        [(tf(ext), [tf(h) for h in holes]) for ext, holes in item.polygons],
        [tf(line) for line in item.lines],
        tf(item.points),
    )


def _polygons_mask(xs: np.ndarray, ys: np.ndarray, polygons: list[tuple[np.ndarray, list[np.ndarray]]]) -> np.ndarray:
    """Points inside any polygon (holes excluded)."""
    total = np.zeros(xs.shape[0], dtype=bool)
    for exterior, holes in polygons:
        if len(exterior) < 3:
            continue
        in_bbox = (
            (xs >= exterior[:, 0].min()) & (xs <= exterior[:, 0].max())
            & (ys >= exterior[:, 1].min()) & (ys <= exterior[:, 1].max())
        )
        idx = np.flatnonzero(in_bbox & ~total)
        if idx.size == 0:
            continue
        px, py = xs[idx], ys[idx]
        inside = _ring_contains(px, py, exterior)
        for hole in holes:
            if len(hole) >= 3:
                inside &= ~_ring_contains(px, py, hole)
        total[idx[inside]] = True
    return total


def _ring_contains(xs: np.ndarray, ys: np.ndarray, ring: np.ndarray) -> np.ndarray:
    """Even-odd ray casting (half-open in y) for many points against one ring."""
    inside = np.zeros(xs.shape[0], dtype=bool)
    p1x, p1y = ring[-1]
    for p2x, p2y in ring:
        cond = (ys > min(p1y, p2y)) & (ys <= max(p1y, p2y)) & (xs <= max(p1x, p2x))
        if p1y != p2y and cond.any():
            if p1x == p2x:
                inside ^= cond
            else:
                x_cross = (ys - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                inside ^= cond & (xs <= x_cross)
        p1x, p1y = p2x, p2y
    return inside


class _BoxIndex:
    """Axis-aligned boxes (cells, or degenerate boxes for edges) sorted by x_min for segment queries."""

    def __init__(self, boxes: np.ndarray):
        boxes = boxes.astype(np.float64)
        self.order = np.argsort(boxes[:, 0], kind='stable')
        self.boxes = boxes[self.order]
        self.max_width = float((boxes[:, 2] - boxes[:, 0]).max()) if len(boxes) else 0.0

    def hit_segment(self, ax: float, ay: float, bx: float, by: float) -> np.ndarray:
        """Indices of boxes whose closure intersects the closed segment (a point when a == b)."""
        lo = np.searchsorted(self.boxes[:, 0], min(ax, bx) - self.max_width, 'left')
        hi = np.searchsorted(self.boxes[:, 0], max(ax, bx), 'right')
        b = self.boxes[lo:hi]
        near = (b[:, 2] >= min(ax, bx)) & (b[:, 1] <= max(ay, by)) & (b[:, 3] >= min(ay, by))
        b = b[near]
        # Liang-Barsky clipping of the segment against each box.
        t0 = np.zeros(len(b))
        t1 = np.ones(len(b))
        for d, a, b_lo, b_hi in ((bx - ax, ax, b[:, 0], b[:, 2]), (by - ay, ay, b[:, 1], b[:, 3])):
            if d == 0.0:
                t1 = np.where((a >= b_lo) & (a <= b_hi), t1, -1.0)
            else:
                ta, tb = (b_lo - a) / d, (b_hi - a) / d
                t0 = np.maximum(t0, np.minimum(ta, tb))
                t1 = np.minimum(t1, np.maximum(ta, tb))
        return self.order[lo:hi][near][t0 <= t1]


# ==================== Solver input files ====================

def write_ne(path: Path, grid: BaseGrid) -> None:
    """ne.txt: id, edge counts (W, E, S, N), edge ids, centre x, centre y, z, type."""
    cx, cy = grid.cell_centres
    xs = [f'{v:.14g}' for v in cx.tolist()]
    ys = [f'{v:.14g}' for v in cy.tolist()]
    zs = [f'{v:.14g}' for v in grid.cell_z.tolist()]
    edge_ids = [str(v) for v in grid.cell_edge_ids.tolist()]
    lines, cursor = [], 0
    for i, (idx, counts, cell_type) in enumerate(zip(grid.cell_index.tolist(), grid.cell_edge_counts.tolist(), grid.cell_type.tolist())):
        n_edges = sum(counts)
        lines.append(', '.join([str(idx), *map(str, counts), *edge_ids[cursor:cursor + n_edges], xs[i], ys[i], zs[i], str(cell_type)]))
        cursor += n_edges
    _write_lines(path, lines)


def write_ns(path: Path, grid: BaseGrid) -> None:
    """ns.txt: id, direction (1 horizontal, 2 vertical), left, right, bottom, top, length, x, y, z, type."""
    e = grid.edges
    horizontal = e['direction'] == 1
    zero = np.zeros(len(e), dtype=np.int64)
    a, b = e['cell_a'].astype(np.int64), e['cell_b'].astype(np.int64)
    columns = [
        e['index'].astype(np.int64),
        np.where(horizontal, 1, 2),
        np.where(horizontal, zero, a),   # left
        np.where(horizontal, zero, b),   # right
        np.where(horizontal, b, zero),   # bottom
        np.where(horizontal, a, zero),   # top
    ]
    ints = [list(map(str, c.tolist())) for c in columns]
    length = np.where(horizontal, e['x_max'] - e['x_min'], e['y_max'] - e['y_min'])
    mx, my = grid.edge_midpoints
    floats = [[f'{v:.14g}' for v in c.tolist()] for c in (length, mx, my, grid.edge_z)]
    types = list(map(str, grid.edge_type.tolist()))
    lines = [', '.join(row) for row in zip(*ints, *floats, types)]
    _write_lines(path, lines)


def _write_lines(path: Path, lines: list[str]) -> None:
    with open(path, 'w', encoding='utf-8', newline='') as f:
        if lines:
            f.write('\n'.join(lines))
            f.write('\n')
