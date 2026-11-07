import assert from 'node:assert/strict'
import test from 'node:test'
import type { CameraOptions, Map, MapOptions } from 'mapbox-gl'
import { lockedMapCameraOptions, lockMapCamera } from '../src/views/mapView/lockedMapCamera'

function handler(enabled = true) {
    return {
        enabled,
        disableCalls: 0,
        disable() { this.enabled = false; this.disableCalls++ },
        isEnabled() { return this.enabled },
    } satisfies Pick<Map['dragPan'], 'disable' | 'isEnabled'> & {
        enabled: boolean
        disableCalls: number
    }
}

// These doubles expose only installed Mapbox public handler methods. Rotation is
// separate from the parent handler so disabling all touch/keyboard input fails.
function camera(options: Partial<MapOptions> = {}) {
    let touchRotation = true
    let keyboardRotation = true
    const map = {
        pitch: options.pitch ?? 45,
        bearing: options.bearing ?? 70,
        center: [120, 30],
        zoom: 11,
        jumps: [] as CameraOptions[],
        dragRotate: handler(options.dragRotate !== false),
        touchPitch: handler(options.touchPitch !== false),
        dragPan: handler(),
        scrollZoom: handler(),
        doubleClickZoom: handler(),
        touchZoomRotate: {
            ...handler(),
            disableRotation() { touchRotation = false },
        } satisfies Pick<Map['touchZoomRotate'], 'disable' | 'isEnabled' | 'disableRotation'> & {
            enabled: boolean
            disableCalls: number
        },
        keyboard: {
            ...handler(),
            disableRotation() { keyboardRotation = false },
        } satisfies Pick<Map['keyboard'], 'disable' | 'isEnabled' | 'disableRotation'> & {
            enabled: boolean
            disableCalls: number
        },
        jumpTo(next: CameraOptions) {
            this.jumps.push(next)
            if (next.pitch !== undefined) this.pitch = next.pitch
            if (next.bearing !== undefined) this.bearing = next.bearing
        },
    }
    return { map, touchRotation: () => touchRotation, keyboardRotation: () => keyboardRotation }
}

function assertLocked(fixture: ReturnType<typeof camera>) {
    const { map } = fixture
    assert.equal(map.pitch, 0)
    assert.equal(map.bearing, 0)
    assert.equal(map.dragRotate.isEnabled(), false, 'right/Ctrl drag rotation and pitch')
    assert.equal(map.touchPitch.isEnabled(), false, 'two/three-finger pitch')
    assert.equal(fixture.touchRotation(), false, 'pinch rotation')
    assert.equal(fixture.keyboardRotation(), false, 'Shift+arrow rotation and pitch')
    for (const name of ['dragPan', 'scrollZoom', 'doubleClickZoom', 'touchZoomRotate', 'keyboard'] as const) {
        assert.equal(map[name].isEnabled(), true, `${name} must stay enabled`)
        assert.equal(map[name].disableCalls, 0, `${name} must not be disabled even temporarily`)
    }
    assert.deepEqual(map.center, [120, 30])
    assert.equal(map.zoom, 11)
    assert.deepEqual(map.jumps, [{ pitch: 0, bearing: 0 }])
}

test('constructor overrides style pitch/bearing and the shared lock preserves pan and zoom', () => {
    const options: MapOptions = { container: 'map', ...lockedMapCameraOptions }
    assert.equal(options.pitch, 0)
    assert.equal(options.bearing, 0)
    assert.deepEqual(lockedMapCameraOptions, { pitch: 0, bearing: 0 })
    for (const name of ['dragPan', 'scrollZoom', 'doubleClickZoom', 'touchZoomRotate', 'keyboard'] as const) {
        assert.notEqual(options[name], false, `${name} must retain Mapbox's enabled default`)
    }
    const fixture = camera(options)
    assert.equal(fixture.map.pitch, 0)
    assert.equal(fixture.map.bearing, 0)
    lockMapCamera(fixture.map)
    assertLocked(fixture)
})

test('reusing an already tilted/rotated map disables every rotation/pitch entry and resets camera', () => {
    const fixture = camera()
    assert.equal(fixture.map.dragRotate.isEnabled(), true)
    assert.equal(fixture.map.touchPitch.isEnabled(), true)
    assert.equal(fixture.touchRotation(), true)
    assert.equal(fixture.keyboardRotation(), true)
    lockMapCamera(fixture.map)
    assertLocked(fixture)
    assert.equal(fixture.map.dragRotate.disableCalls, 1)
    assert.equal(fixture.map.touchPitch.disableCalls, 1)
})

test('each shared-map remount reapplies the lock before either editing or read-only use', () => {
    const fixture = camera()
    lockMapCamera(fixture.map)
    fixture.map.pitch = 20
    fixture.map.bearing = -40
    fixture.map.dragRotate.enabled = true
    fixture.map.touchPitch.enabled = true
    fixture.map.jumps.length = 0
    lockMapCamera(fixture.map)
    assertLocked(fixture)
    assert.equal(fixture.map.dragRotate.disableCalls, 2)
    assert.equal(fixture.map.touchPitch.disableCalls, 2)
})
