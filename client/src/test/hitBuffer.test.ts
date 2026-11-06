import assert from 'node:assert/strict'
import test from 'node:test'

import HitBuffer from '../src/views/mapView/topology/hitBuffer'

test('tracks sparse IDs and returns unique sorted selections', () => {
    const hits = new HitBuffer()
    assert.equal(hits.isHitting, false)
    hits.add(1_000_000_000)
    hits.add(2)
    hits.add(2)
    assert.deepEqual(hits.all, [2, 1_000_000_000])
    assert.equal(hits.isHit(1_000_000_000), true)
    hits.all = [9, 3, 9]
    assert.deepEqual(hits.all, [3, 9])
    hits.remove(3)
    assert.deepEqual(hits.clear(), [9])
    assert.deepEqual(hits.all, [])
    assert.equal(hits.isHitting, false)
})
