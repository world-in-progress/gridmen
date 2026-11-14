import assert from 'node:assert/strict'
import test from 'node:test'
import { parsePreservedLulcClasses } from '../src/template/grid/preservedLulc'

test('preserved LULC accepts a nonempty integer list with whitespace and boundary classes', () => {
    assert.deepEqual(parsePreservedLulcClasses('8, 5'), [8, 5])
    assert.deepEqual(parsePreservedLulcClasses(' 0, 255 '), [0, 255])
    assert.deepEqual(parsePreservedLulcClasses('8'), [8])
})

test('preserved LULC rejects empty, noninteger, boolean, out-of-range and duplicate classes', () => {
    for (const input of ['', ' ', ',', '8,', ',8', '8,,5', '[]', '[8]', '{}', '1.5',
        '8.0', 'true', 'false', '8, true', '-1', '256', '8, 8', '08, 8', 'NaN', 'Infinity']) {
        assert.equal(parsePreservedLulcClasses(input), null, input)
    }
})
