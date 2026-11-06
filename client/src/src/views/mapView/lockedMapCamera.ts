import type { CameraOptions, Map, MapOptions } from 'mapbox-gl'

// Constructor options also override any bearing/pitch supplied by the style.
export const lockedMapCameraOptions = {
    pitch: 0,
    bearing: 0,
    pitchWithRotate: false,
    dragRotate: false,
    touchPitch: false,
} satisfies Partial<MapOptions>

type LockedMapCamera = {
    dragRotate: Pick<Map['dragRotate'], 'disable'>
    touchZoomRotate: Pick<Map['touchZoomRotate'], 'disableRotation'>
    touchPitch: Pick<Map['touchPitch'], 'disable'>
    keyboard: Pick<Map['keyboard'], 'disableRotation'>
    jumpTo: (options: CameraOptions) => unknown
}

/** Apply to both new maps and the shared map before exposing it to a view. */
export function lockMapCamera(map: LockedMapCamera): void {
    // Right-drag / Ctrl-drag control both mouse rotation and mouse pitch.
    map.dragRotate.disable()
    // Keep pinch zoom and keyboard zoom/pan, while disabling their rotation/pitch.
    map.touchZoomRotate.disableRotation()
    map.touchPitch.disable()
    map.keyboard.disableRotation()
    // jumpTo also stops an existing camera animation when reusing the map.
    map.jumpTo({ pitch: 0, bearing: 0 })
}
