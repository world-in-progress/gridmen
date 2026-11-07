import sys
import types
import struct
import json
import mmap
import numpy as np
import pytest
from importlib import import_module
from pathlib import Path

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


@pytest.mark.parametrize('kind', ['cell', 'edge'])
@pytest.mark.parametrize('failure', [None, RuntimeError, KeyboardInterrupt])
def test_topology_recording_publishes_closed_files_and_preserves_old_readers(
        tmp_path, monkeypatch, kind, failure):
    path = tmp_path / f'{kind}_topo.bin'
    path.write_bytes(b'original topology')

    class Grid:
        def __len__(self):
            return 1

        def slice_cells(self, *args):
            return b''

        def slice_edges(self, *args):
            return []

    class Pool:
        def __init__(self, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def imap(self, *args):
            yield b'new topology', assembly._make_phase_stats()
            assert path.read_bytes() == b'original topology'
            if failure:
                raise failure('recording interrupted')

    monkeypatch.setattr(assembly.mp, 'Pool', Pool)
    with path.open('rb') as source, mmap.mmap(source.fileno(), 0, access=mmap.ACCESS_READ) as reader:
        def record():
            if kind == 'cell':
                assembly._record_cell_topology(Grid(), [0, 0, 1, 1], [], [], path)
            else:
                assembly._record_edge_topology([b''], [[None, 0]], [0, 0, 1, 1], path)

        if failure:
            with pytest.raises(failure, match='recording interrupted'):
                record()
        else:
            record()
        assert reader[:] == b'original topology'
    assert path.read_bytes() == (b'original topology' if failure else b'new topology')
    assert sorted(p.name for p in tmp_path.iterdir()) == [path.name]


def test_topology_replace_failure_keeps_existing_file(tmp_path, monkeypatch):
    path = tmp_path / 'cell_topo.bin'
    path.write_bytes(b'original')

    def denied(*args):
        raise PermissionError('mapped destination')

    monkeypatch.setattr(Path, 'replace', denied)
    with pytest.raises(PermissionError, match='mapped destination'):
        with assembly._topology_output(path) as output:
            output.write(b'replacement')
    assert output.closed and path.read_bytes() == b'original'
    assert list(tmp_path.iterdir()) == [path]


@pytest.fixture
def raster_file(tmp_path):
    def write(data, *, nodata=None, transform=None, crs="EPSG:2326", name="sample.tif"):
        data = np.asarray(data)
        path = tmp_path / name
        with assembly.rasterio.open(
            path, "w", driver="GTiff", height=data.shape[0], width=data.shape[1],
            count=1, dtype=data.dtype, nodata=nodata, crs=crs,
            transform=transform or assembly.rasterio.transform.from_origin(0, data.shape[0], 1, 1),
        ) as dst:
            dst.write(data, 1)
        return path
    return write


@pytest.mark.parametrize("bounds, expected", [
    ([0, 2, 2, 4], 2.5),
    ([0.6, 0.6, 2.6, 2.6], 7.5),
    ([0.5, 0.5, 2.5, 2.5], 10.5),
])
def test_cell_mean_uses_half_open_pixel_centres(raster_file, bounds, expected):
    path = raster_file(np.arange(16, dtype=np.float32).reshape(4, 4))
    with assembly.rasterio.open(path) as src:
        actual = assembly._sample_cell_raster_values(src, [bounds])
    assert actual.tolist() == [expected]


def test_cell_mean_converts_pixels_before_float64_accumulation(raster_file):
    path = raster_file(np.array([[1e8, 1], [1, 1]], dtype=np.float32))
    with assembly.rasterio.open(path) as src:
        actual = assembly._sample_cell_raster_values(src, [[0, 0, 2, 2]])
    assert actual[0] == 25000000.75


@pytest.mark.parametrize("categorical", [False, True])
def test_single_pixel_cell_matches_point_sampling_bit_for_bit(raster_file, categorical):
    data = np.array([[-0.0, np.nextafter(np.float32(1), np.float32(2))], [7, 9]], dtype=np.float32)
    path = raster_file(data)
    bounds = np.array([[0.1, 1.1, 1.1, 2.1], [1.1, 1.1, 2.1, 2.1], [0.1, 0.1, 1.1, 1.1]])
    with assembly.rasterio.open(path) as src:
        expected = assembly._sample_raster_values(src, (bounds[:, 0] + bounds[:, 2]) / 2,
                                                   (bounds[:, 1] + bounds[:, 3]) / 2)
        actual = assembly._sample_cell_raster_values(src, bounds, categorical=categorical)
    assert actual.tobytes() == expected.tobytes()


def test_cell_mean_does_not_depend_on_other_cells_in_the_batch(raster_file):
    # Large and tiny pixel values make float64 prefix sums round, so the sums' origin matters.
    rng = np.random.default_rng(7)
    data = rng.uniform(0, 900, (512, 512)).astype(np.float32)
    data[1::2, 1::2] = rng.uniform(0, 0.01, (256, 256)).astype(np.float32)
    path = raster_file(data)
    cell = [480.0, 0.0, 496.0, 16.0]
    with assembly.rasterio.open(path) as src:
        alone = assembly._sample_cell_raster_values(src, [cell])
        batched = assembly._sample_cell_raster_values(src, [[0.0, 496.0, 2.0, 512.0], cell])
    assert alone[0].tobytes() == batched[1].tobytes()


def test_subpixel_cell_falls_back_to_containing_centre_pixel(raster_file):
    path = raster_file(np.array([[1, 2], [3, 4]], dtype=np.float32))
    with assembly.rasterio.open(path) as src:
        actual = assembly._sample_cell_raster_values(src, [[0.8, 0.8, 1.2, 1.2], [2, 0, 2.2, 0.2]])
    assert actual[0] == 4
    assert np.isnan(actual[1])


@pytest.mark.parametrize("categorical, expected", [(False, 2.0), (True, 1.0)])
def test_cell_statistics_exclude_nodata_and_nan(raster_file, categorical, expected):
    path = raster_file(np.array([[1, np.nan, -9], [3, -9.00001, -9]], dtype=np.float64), nodata=-9)
    with assembly.rasterio.open(path) as src:
        actual = assembly._sample_cell_raster_values(src, [[0, 0, 3, 2]], categorical=categorical)
    assert actual.tolist() == [expected]


def test_all_invalid_cell_records_use_missing_values(raster_file):
    path = raster_file(np.array([[-9, np.nan], [np.nan, -9]], dtype=np.float32), nodata=-9)
    chunk, _ = assembly._batch_cell_records_worker(
        (struct.pack("!BQ", 1, 0), [[[], [], [], []]], 0), [0, 0, 2, 2],
        [{}, {"width": 1}], [[2, 2]], dem_path=path, lum_path=path,
    )
    record = struct.unpack("!QdddddBBBBB", chunk[4:])
    assert record[5:7] == (-9999.0, 0)


@pytest.mark.parametrize("data, expected", [
    ([[9, 5], [5, 9]], 5),
    ([[-1.9, -1.1], [2.9, 2.9]], 2),
    ([[300, 300], [1, 2]], 0),
])
def test_lulc_mode_breaks_ties_before_integer_conversion(raster_file, data, expected):
    path = raster_file(np.array(data, dtype=np.float64))
    chunk, _ = assembly._batch_cell_records_worker(
        (struct.pack("!BQ", 1, 0), [[[], [], [], []]], 0), [0, 0, 2, 2],
        [{}, {"width": 1}], [[2, 2]], lum_path=path,
    )
    assert struct.unpack("!QdddddBBBBB", chunk[4:])[6] == expected


@pytest.mark.parametrize("raster_argument", ["dem_path", "lum_path"])
def test_assembly_rejects_wrong_crs_before_topology_work(tmp_path, monkeypatch, raster_file, raster_argument):
    dem_path = raster_file(np.ones((2, 2), dtype=np.float32), name="dem.tif")
    path = raster_file(np.ones((2, 2), dtype=np.float32), crs="EPSG:4326")
    schema = tmp_path / "resource/test/schema"
    schema.mkdir(parents=True)
    (schema / "schema.json").write_text(json.dumps({"epsg": 2326}))
    monkeypatch.chdir(tmp_path)
    with pytest.raises(ValueError, match="reproject.*schema CRS"):
        assembly.assembly(tmp_path, ".test.schema", [".absent"], **{"dem_path": dem_path, raster_argument: path})


@pytest.mark.parametrize("dem_path", [None, ""])
def test_assembly_requires_dem_before_schema_or_topology_work(tmp_path, dem_path):
    with pytest.raises(ValueError, match="Assembly requires 'dem_path'"):
        assembly.assembly(tmp_path, ".absent.schema", [".absent.patch"], dem_path=dem_path)


def test_assembly_rejects_missing_dem_before_schema_or_topology_work(tmp_path):
    with pytest.raises(FileNotFoundError, match="missing.tif"):
        assembly.assembly(tmp_path, ".absent.schema", [".absent.patch"], dem_path=tmp_path / "missing.tif")


def test_raster_validation_accepts_equivalent_wkt(raster_file):
    crs = assembly.CRS.from_epsg(2326)
    wkt = crs.to_wkt(version="WKT1_GDAL", output_axis_rule=True)
    path = raster_file(np.ones((2, 2), dtype=np.float32), crs=wkt)
    assembly._validate_raster(path, crs)


def test_raster_validation_accepts_same_epsg_with_different_axis_and_ellipsoid_wkt(monkeypatch, tmp_path):
    crs = assembly.CRS.from_epsg(2326)
    wkt = crs.to_wkt(version="WKT1_GDAL", output_axis_rule=True)
    wkt = wkt.replace('AXIS["Northing",NORTH],AXIS["Easting",EAST]',
                      'AXIS["Easting",EAST],AXIS["Northing",NORTH]')
    wkt = wkt.replace('6378388,297,', '6378388,297.000000000005,')
    class FakeRaster:
        crs = assembly.rasterio.crs.CRS.from_wkt(wkt)
        transform = assembly.rasterio.transform.from_origin(0, 2, 1, 1)

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    path = tmp_path / "raster.tif"
    path.touch()
    assert assembly.CRS.from_user_input(FakeRaster.crs).to_json_dict()['id'] == {'authority': 'EPSG', 'code': 2326}
    assert not assembly.CRS.from_user_input(FakeRaster.crs).equals(crs, ignore_axis_order=True)
    monkeypatch.setattr(assembly.rasterio, "open", lambda path: FakeRaster())
    assembly._validate_raster(path, crs)


def test_raster_validation_uses_axis_order_agnostic_equivalence(monkeypatch, tmp_path):
    class FakeRaster:
        crs = assembly.CRS.from_user_input("OGC:CRS84")
        transform = assembly.rasterio.transform.from_origin(0, 2, 1, 1)

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    path = tmp_path / "raster.tif"
    path.touch()
    monkeypatch.setattr(assembly.rasterio, "open", lambda path: FakeRaster())
    assert not assembly.CRS.from_user_input(FakeRaster.crs).equals(assembly.CRS.from_epsg(4326))
    assembly._validate_raster(path, assembly.CRS.from_epsg(4326))


@pytest.mark.parametrize("transform", [
    assembly.rasterio.Affine(1, 0.1, 0, 0, -1, 2),
    assembly.rasterio.Affine(1, 0, 0, 0.1, -1, 2),
    assembly.rasterio.Affine(1, 0, 0, 0, 1, 2),
    assembly.rasterio.Affine(-1, 0, 0, 0, -1, 2),
])
def test_raster_validation_rejects_rotation_and_non_north_up(raster_file, transform):
    path = raster_file(np.ones((2, 2), dtype=np.float32), transform=transform)
    with pytest.raises(ValueError, match="north-up.*reproject"):
        assembly._validate_raster(path, assembly.CRS.from_epsg(2326))


def test_coarse_cell_windows_remain_spatially_bounded(raster_file):
    path = raster_file(np.ones((1024, 2048), dtype=np.float32))
    windows = []
    with assembly.rasterio.open(path) as src:
        class RecordingRaster:
            def __getattr__(self, name):
                return getattr(src, name)

            def read(self, band, window):
                windows.append(window)
                return src.read(band, window=window)

        bounds = [[x, y, x + 64, y + 64] for x in range(0, 2048, 64) for y in range(0, 1024, 64)]
        values = assembly._sample_cell_raster_values(RecordingRaster(), bounds)
    assert (values == 1).all()
    assert len(windows) == 8
    assert max(w.width * w.height for w in windows) <= 512 * 512


def test_batched_rectangle_queries_match_direct_masked_reductions(raster_file):
    rng = np.random.default_rng(17)
    data = rng.integers(-5, 20, (40, 50)).astype(np.float32)
    data[::3, ::4] = np.nan
    data[::4, ::3] = -9
    bounds = [[x + 0.5, y + 0.5, x + 5.5, y + 7.5] for x in range(0, 40, 4) for y in range(0, 30, 3)]
    path = raster_file(data, nodata=-9)
    expected = []
    xs, ys = np.arange(50) + 0.5, 40 - np.arange(40) - 0.5
    for x0, y0, x1, y1 in bounds:
        mask = (xs[None, :] >= x0) & (xs[None, :] < x1) & (ys[:, None] >= y0) & (ys[:, None] < y1)
        pixels = data[mask].astype(np.float64)
        pixels = pixels[~np.isnan(pixels) & (pixels != -9)]
        expected.append(pixels.mean())
    with assembly.rasterio.open(path) as src:
        actual = assembly._sample_cell_raster_values(src, bounds)
    assert actual.tobytes() == np.asarray(expected).tobytes()


def test_generate_cell_record_from_precomputed_geometry_matches_existing_shape():
    expected = struct.pack(
        "!QdddddBBBBBQQQQ",
        1,
        10.0,
        20.0,
        30.0,
        40.0,
        5.5,
        7,
        1,
        1,
        1,
        1,
        3,
        5,
        4,
        2,
    )
    edges = [[1], [2], [3], [4]]
    record = assembly._generate_cell_record_from_geometry(
        index=0,
        min_xs=10.0,
        min_ys=20.0,
        max_xs=30.0,
        max_ys=40.0,
        edges=edges,
        altitude=5.5,
        lum_type=7,
    )
    assert isinstance(record, (bytes, bytearray))
    assert record == expected
    assert len(record) == struct.calcsize("!QdddddBBBBBQQQQ")


def test_generate_cell_record_from_precomputed_geometry_rejects_uint8_overflow():
    edges = [[], [], [], [0] * 256]

    try:
        assembly._generate_cell_record_from_geometry(
            index=0,
            min_xs=10.0,
            min_ys=20.0,
            max_xs=30.0,
            max_ys=40.0,
            edges=edges,
            altitude=5.5,
            lum_type=7,
        )
    except ValueError as exc:
        message = str(exc)
        assert "east_edge_count=256" in message
        assert "Cell record uint8 overflow" in message
        assert "center=(20.00, 30.00)" in message
    else:
        raise AssertionError("Expected ValueError for uint8 overflow")


def test_batch_cell_records_worker_adds_level_and_global_id_to_overflow_errors(monkeypatch):
    def fake_generate_cell_record_from_geometry(**kwargs):
        raise ValueError("Cell record uint8 overflow: east_edge_count=256 (valid: 0-255). cell index=1, center=(2.50, 1.50)")

    monkeypatch.setattr(assembly, "_generate_cell_record_from_geometry", fake_generate_cell_record_from_geometry)

    cell_data = struct.pack(">BQ", 1, 2)
    cell_edges = [[[], [], [], []]]

    with pytest.raises(ValueError, match=r"level=1, global_id=2"):
        assembly._batch_cell_records_worker(
            (cell_data, cell_edges, 0),
            [0.0, 0.0, 10.0, 10.0],
            meta_level_info=[{}, {"width": 2}],
            grid_info=[[1.0, 1.0]],
            dem_path=None,
            lum_path=None,
        )


def test_generate_edge_record_from_precomputed_geometry_matches_existing_shape():
    expected = struct.pack(
        "!QBddddQQdi",
        1,
        1,
        10.0,
        20.0,
        30.0,
        20.0,
        8,
        9,
        9.5,
        3,
    )
    record = assembly._generate_edge_record_from_geometry(
        index=0,
        direction=1,
        x_min=10.0,
        y_min=20.0,
        x_max=30.0,
        y_max=20.0,
        edge_grids=[7, 8],
        altitude=9.5,
        lum_type=3,
    )
    assert isinstance(record, (bytes, bytearray))
    assert record == expected
    assert len(record) == struct.calcsize("!QBddddQQdi")


def test_get_edge_coordinates_rejects_unknown_direction():
    edge_data = struct.pack("!BIIIIII", 2, 1, 1, 2, 1, 3, 1)

    with pytest.raises(ValueError, match="Unexpected edge direction=2"):
        assembly._get_edge_coordinates(edge_data, [0.0, 0.0, 1.0, 1.0])


def test_batch_edge_records_worker_clamps_out_of_range_lum_type(monkeypatch):
    class FakeRaster:
        dtypes = ["uint16"]
        nodata = None

        def close(self):
            return None

    monkeypatch.setattr(assembly.os.path, "exists", lambda path: True)
    monkeypatch.setattr(assembly.rasterio, "open", lambda path: FakeRaster())
    monkeypatch.setattr(assembly, "_sample_raster_values", lambda *args, **kwargs: np.array([300.0]))

    edge_data = struct.pack("!BIIIIII", 1, 1, 1, 2, 1, 3, 1)
    chunk, _stats = assembly._batch_edge_records_worker(
        ([edge_data], [[7, 8]], 0),
        [0.0, 0.0, 10.0, 10.0],
        dem_path=None,
        lum_path="fake-lum.tif",
    )

    record_len = struct.unpack("!I", chunk[:4])[0]
    record = chunk[4 : 4 + record_len]
    unpacked = struct.unpack("!QBddddQQdi", record)

    assert unpacked[-1] == 0


def test_sample_raster_values_reads_each_block_once(monkeypatch):
    read_windows = []

    class FakeRaster:
        crs = "EPSG:2326"
        bounds = types.SimpleNamespace(left=0.0, bottom=0.0, right=4.0, top=4.0)
        transform = assembly.rasterio.transform.from_origin(0.0, 4.0, 1.0, 1.0)
        block_shapes = [(2, 2)]
        nodata = None
        dtypes = ["int16"]

        def read(self, band_index, window):
            read_windows.append((window.col_off, window.row_off, window.width, window.height))
            if (window.col_off, window.row_off) == (0, 0):
                return np.array([[10, 11], [12, 13]], dtype=np.int16)
            raise AssertionError(f"Unexpected window: {window}")

    values = assembly._sample_raster_values(
        FakeRaster(),
        [0.5, 1.5],
        [3.5, 2.5],
    )

    assert values.tolist() == [10.0, 13.0]
    assert read_windows == [(0, 0, 2, 2)]


def test_sample_raster_values_marks_outside_nodata_and_nan_as_missing(monkeypatch):
    class FakeRaster:
        crs = "EPSG:2326"
        bounds = types.SimpleNamespace(left=0.0, bottom=0.0, right=2.0, top=2.0)
        transform = assembly.rasterio.transform.from_origin(0.0, 2.0, 1.0, 1.0)
        block_shapes = [(2, 2)]
        nodata = -9.0
        dtypes = ["float32"]

        def read(self, band_index, window):
            return np.array([[1.0, -9.0], [np.nan, 4.0]], dtype=np.float32)

    values = assembly._sample_raster_values(
        FakeRaster(),
        [0.5, 1.5, 0.5, 1.5, 5.0],
        [1.5, 1.5, 0.5, 0.5, 5.0],
    )

    assert values[0] == 1.0 and values[3] == 4.0
    assert np.isnan(values[[1, 2, 4]]).all()


def test_batch_edge_records_worker_uses_batch_sampler(monkeypatch):
    sample_calls = []

    class FakeRaster:
        dtypes = ["uint8"]
        nodata = None

        def close(self):
            return None

    def fake_sample_raster_values(src, xs, ys):
        sample_calls.append((src, tuple(xs), tuple(ys)))
        return np.array([300.0])

    monkeypatch.setattr(assembly.os.path, "exists", lambda path: True)
    monkeypatch.setattr(assembly.rasterio, "open", lambda path: FakeRaster())
    monkeypatch.setattr(assembly, "_sample_raster_values", fake_sample_raster_values)

    edge_data = struct.pack("!BIIIIII", 1, 1, 1, 2, 1, 3, 1)
    chunk, stats = assembly._batch_edge_records_worker(
        ([edge_data], [[7, 8]], 0),
        [0.0, 0.0, 10.0, 10.0],
        dem_path="fake-dem.tif",
        lum_path="fake-lum.tif",
    )

    record_len = struct.unpack("!I", chunk[:4])[0]
    record = chunk[4 : 4 + record_len]
    unpacked = struct.unpack("!QBddddQQdi", record)

    assert len(sample_calls) == 2
    assert unpacked[-2] == 300.0
    assert unpacked[-1] == 0
    assert set(stats) == {"dem_sample", "lum_sample", "pack"}
    assert all(value >= 0.0 for value in stats.values())

def test_record_cell_topology_logs_single_aggregated_sampling_summary(monkeypatch, tmp_path):
    calls = []
    debug_logs = []

    def fake_timed(label, **extra):
        calls.append(label)

        class _Ctx:
            def __enter__(self):
                return None

            def __exit__(self, exc_type, exc, tb):
                return False

        return _Ctx()

    class FakeGridCache:
        def __len__(self):
            return 10001

        def slice_cells(self, start, batch_size):
            return b""

        def slice_edges(self, start, batch_size):
            return []

    class FakePool:
        def __init__(self, processes):
            self.processes = processes

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def imap(self, batch_func, batch_args):
            for _ in batch_args:
                yield b"", {"dem_sample": 1.25, "lum_sample": 2.5, "pack": 0.75}

    monkeypatch.setattr(assembly, "timed", fake_timed)
    monkeypatch.setattr(assembly, "log_debug", lambda msg, *args: debug_logs.append(msg % args if args else msg))
    monkeypatch.setattr(assembly.mp, "Pool", FakePool)

    assembly._record_cell_topology(
        FakeGridCache(),
        [0.0, 0.0, 1.0, 1.0],
        [],
        [],
        str(tmp_path / "grid.bin"),
        dem_path="fake-dem.tif",
        lum_path="fake-lum.tif",
    )

    assert "record.cell.pool_total" in calls
    assert "record.cell.build_batch_args" not in calls
    assert "record.cell.parent_write" not in calls
    assert any(
        "record.cell.phase_totals" in entry
        and "dem_sample=2.5000s" in entry
        and "lum_sample=5.0000s" in entry
        and "pack=1.5000s" in entry
        for entry in debug_logs
    )
