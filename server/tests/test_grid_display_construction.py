"""Construction boundaries shared by fixed and hanging topology records."""
import hashlib
import io
import json
import os
import struct
from pathlib import Path

import pytest

import gridmen_backend.grid_display as display
from test_grid_display import decode_nodes, write_grid


def test_fingerprint_stats_only_four_display_sources_once(tmp_path, monkeypatch):
    source = write_grid(tmp_path/'source', [((0,0,8,8), 1, 3)])
    original = Path.stat
    calls = []

    def stat(path, *args, **kwargs):
        calls.append(path.name)
        return original(path, *args, **kwargs)

    monkeypatch.setattr(Path, 'stat', stat)
    result = display.fingerprint(source)
    assert calls == list(display.FILES) == ['grid.meta.json', 'cell_topo.bin', 'edge_topo.bin', 'ne.txt']
    assert all(len(entry) == 3 for entry in result)


def test_ns_is_neither_parsed_nor_part_of_revision(tmp_path):
    source = write_grid(tmp_path/'source', [((0,0,8,8), 1, 3)])
    cache = tmp_path/'cache'
    (source/'ns.txt').write_text('not display data')
    index = display.GridDisplayIndex(source, cache)
    revision = index.revision
    assert set(index.meta) == {'revision', 'epsg', 'bounds', 'alignment_origin',
                               'grid_info', 'elevationRange', 'landClasses'}
    assert set(index.manifest) == {'source', 'meta', 'layers', 'layerTiles', 'rootHistograms'}
    assert not list(index.directory.glob('hist-*'))
    assert not (index.directory/'identity.json').exists()
    index.close()
    (source/'ns.txt').unlink()
    reopened = display.GridDisplayIndex(source, cache)
    try:
        assert reopened.revision == revision
        assert reopened.inspect(1,1)['cell']['landClass'] == 3
    finally:
        reopened.close()


def test_layers_follow_shared_canonical_vectors():
    vectors = json.loads((Path(__file__).resolve().parents[2]/'docs/display-hierarchy-vectors.json').read_text())
    total = 0
    for case in vectors['cases']:
        actual = []
        for spec in display.layer_specs(case['meta']):
            fields = dict(zip(('width','height','x0','y0','nx','ny'), spec[:6]))
            fields.update(nativeLevel=spec[6] if spec[6] > 0 else None,
                          xLayout=spec[7][0] if len(spec) == 8 else None,
                          yLayout=spec[7][1] if len(spec) == 8 else None)
            actual.append([fields[key] for key in vectors['layerFields']])
        assert actual == case['layers'], case['name']
        total += len(actual)
    assert len(vectors['cases']) == 7 and total == 60


def snapshot(source):
    return {name: hashlib.sha256((source/name).read_bytes()).hexdigest()
            for name in display.FILES}


@pytest.mark.parametrize('name,column,value', [
    ('ne.txt', 0, '1.0'), ('ne.txt', 1, '1e0'),
    ('ne.txt', -1, '3.0'), ('ne.txt', -1, '256'),
])
def test_csv_integer_fields_remain_strict(tmp_path, name, column, value):
    source = write_grid(tmp_path/'source', [((0,0,8,8), 1, 3)])
    path = source/name
    lines = path.read_text().splitlines()
    row = lines[0].split(',')
    row[column] = value
    lines[0] = ','.join(row)
    path.write_text('\n'.join(lines)+'\n')
    before = snapshot(source)
    with pytest.raises(ValueError):
        display.GridDisplayIndex(source, tmp_path/'cache')
    assert snapshot(source) == before


@pytest.mark.parametrize('identifier', [(1 << 53)+1, (1 << 64)-1])
@pytest.mark.parametrize('trailing_floats,fields', [
    (3, '1,1,1,1,2,4,3,1,4.5,4.5,1.5,3'),
    (4, '1,0,0,0,1,4,4.5,4.5,1.5,3'),
])
def test_csv_preserves_uint64_topology_identifiers(tmp_path, identifier, trailing_floats, fields):
    path = tmp_path/'sample.txt'
    path.write_text(f'{identifier},{fields}\n')
    values, _, _ = next(display._text_batches(path,trailing_floats))
    assert int(values[0]) == identifier


@pytest.mark.parametrize('name', ['ne.txt'])
@pytest.mark.parametrize('change', ['extra-column', 'missing-row', 'extra-row', 'blank-row'])
def test_csv_record_and_column_counts_are_checked(tmp_path, name, change):
    source = write_grid(tmp_path/'source', [((0,0,8,8), 1, 3)])
    path = source/name
    lines = path.read_text().splitlines(keepends=True)
    if change == 'extra-column':
        lines[0] = lines[0].rstrip('\n')+',0\n'
    elif change == 'missing-row':
        lines.pop()
    elif change == 'extra-row':
        lines.append(lines[-1])
    else:
        lines.append('\n')
    path.write_text(''.join(lines))
    with pytest.raises(ValueError):
        display.GridDisplayIndex(source, tmp_path/'cache')


@pytest.mark.parametrize('ending', [b'', b'\r\n', b'\r'])
def test_csv_accepts_final_record_without_newline_and_crlf(tmp_path, ending):
    source = write_grid(tmp_path/'source', [((0,0,8,8), 1, 3)])
    for name in ('ne.txt', 'ns.txt'):
        path = source/name
        data = path.read_bytes()
        path.write_bytes(data.rstrip(b'\n') if not ending else data.replace(b'\n', ending))
    index = display.GridDisplayIndex(source, tmp_path/'cache')
    try:
        assert index.inspect(1,1)['cell']['landClass'] == 3
    finally:
        index.close()


@pytest.mark.parametrize('ending', [b'\n', b'\r\n', b'\r'])
@pytest.mark.parametrize('read_size', [1,2,7,16])
def test_csv_batches_handle_split_universal_newlines(tmp_path, monkeypatch, ending, read_size):
    row = b'1,1,1,1,1,2,4,3,1,4.5,4.5,1.5,3'
    data = ending.join([row]*5)
    target = tmp_path/'sample.txt'
    original = Path.open

    class ShortReads(io.BytesIO):
        def read(self, size=-1):
            return super().read(min(size,read_size))

        def readline(self, *args):
            raise AssertionError('Batch reader used an unbounded line read')

    def open_file(path, *args, **kwargs):
        return ShortReads(data) if path == target else original(path,*args,**kwargs)

    monkeypatch.setattr(Path, 'open', open_file)
    records = []
    for values, starts, widths in display._text_batches(target,3):
        records.extend(values[start:start+width].tolist() for start,width in zip(starts,widths))
    assert records == [[1,1,1,1,1,2,4,3,1,4.5,4.5,1.5,3]]*5


@pytest.mark.parametrize('low,high', [(4.,8.), (1_000_000.,1_000_001.)])
def test_float64_directory_coalesces_complete_low_word_ranges(low, high):
    assert len(display._coordinate_ranges(low,high)) == 1
    assert len(display._rectangle_ranges((low,low,high,high))) == 1


def test_hanging_segments_accept_unsorted_ids_and_keep_true_extrema(tmp_path):
    source = write_grid(tmp_path/'source', [
        ((0,0,8,8), 10, 9), ((8,0,12,4), 2, 3), ((8,4,12,8), 4, 3),
    ], bounds=(0,0,12,8))
    path = source/'cell_topo.bin'
    binary = bytearray(path.read_bytes())
    header = display.CELL.unpack_from(binary, 4)
    counts = header[7:]
    assert counts[1] == 2
    start = 4+display.CELL.size+8*counts[0]
    first, second = struct.unpack_from('!QQ', binary, start)
    struct.pack_into('!QQ', binary, start, second, first)
    path.write_bytes(binary)
    path = source/'ne.txt'
    lines = path.read_text().splitlines()
    row = lines[0].split(',')
    start = 5+counts[0]
    row[start:start+2] = row[start:start+2][::-1]
    lines[0] = ','.join(row)
    path.write_text('\n'.join(lines)+'\n')
    before = snapshot(source)
    index = display.GridDisplayIndex(source, tmp_path/'cache')
    try:
        assert {n['cell']['id'] for n in index.inspect(1,1)['neighbors']} == {2,3}
        top = len(index.layers)-1
        record = decode_nodes(index.nodes(top,0,0,top))[0]
        assert record[5:] == (96,736,4,2,9)
        assert index._roots[0][3] == {3:2,9:4}
    finally:
        index.close()
    assert snapshot(source) == before


def test_source_stat_change_rebuilds_and_rejects_bad_grid(tmp_path):
    source = write_grid(tmp_path/'source', [((0,0,8,8), 1, 3)])
    cache = tmp_path/'cache'
    index = display.GridDisplayIndex(source, cache)
    index.close()
    path = source/'cell_topo.bin'
    binary = bytearray(path.read_bytes())
    struct.pack_into('!Q', binary, 4, 2)
    path.write_bytes(binary)
    with pytest.raises(ValueError, match='Cell IDs must be sequential'):
        display.GridDisplayIndex(source, cache)


def test_cached_reopen_does_not_revalidate_sources(tmp_path, monkeypatch):
    source = write_grid(tmp_path/'source', [((0,0,8,8), 1, 3)])
    cache = tmp_path/'cache'
    index = display.GridDisplayIndex(source, cache)
    index.close()

    def no_scan(*args, **kwargs):
        raise AssertionError('Cached reopen revalidated sources')

    monkeypatch.setattr(display, 'checked_meta', no_scan)
    monkeypatch.setattr(display, '_read_cells', no_scan)
    monkeypatch.setattr(display, '_read_edges', no_scan)
    index = display.GridDisplayIndex(source, cache)
    index.close()


def test_source_mtime_change_changes_deterministic_revision(tmp_path):
    source = write_grid(tmp_path/'source', [((0,0,8,8), 1, 3)])
    cache = tmp_path/'cache'
    index = display.GridDisplayIndex(source,cache)
    previous_directory = index.directory
    index.close()
    before = snapshot(source)
    path = source/'ne.txt'
    stat = path.stat()
    os.utime(path,ns=(stat.st_atime_ns,stat.st_mtime_ns+1))
    rebuilt = display.GridDisplayIndex(source,cache)
    try:
        assert rebuilt.directory != previous_directory
        assert snapshot(source) == before
    finally:
        rebuilt.close()
