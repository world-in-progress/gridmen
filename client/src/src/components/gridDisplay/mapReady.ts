import type { Map as MapboxMap } from 'mapbox-gl'

export function waitForDisplayMap(map: MapboxMap, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (map.isStyleLoaded()) return Promise.resolve()
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            map.off('load', ready)
            map.off('style.load', ready)
            signal.removeEventListener('abort', abort)
        }
        const ready = () => { cleanup(); resolve() }
        const abort = () => { cleanup(); reject(signal.reason) }
        map.on('load', ready)
        map.on('style.load', ready)
        signal.addEventListener('abort', abort, { once: true })
    })
}
