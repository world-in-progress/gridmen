import { useEffect, useState } from 'react'
import type { Map as MapboxMap, MapMouseEvent } from 'mapbox-gl'
import type { GridInspection } from '@/core/grid/displayTypes'
import type TopologyLayer from '@/views/mapView/topology/TopologyLayer'
import { errorMessage } from '@/i18n/gridDisplay'

export function useGridInspection(map: MapboxMap, layer: TopologyLayer, enabled: boolean) {
    const [inspection, setInspection] = useState<GridInspection | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        setInspection(null)
        setError(null)
        setLoading(false)
        if (!enabled) return
        let active = true
        let request = 0
        const inspect = async (event: MapMouseEvent) => {
            const current = ++request
            setLoading(true)
            setError(null)
            setInspection(null)
            try {
                const result = await layer.inspectAt([event.point.x, event.point.y])
                if (active && current === request) setInspection(result)
            } catch (cause) {
                if (active && current === request && !(cause instanceof Error && cause.name === 'AbortError')) setError(errorMessage(cause))
            } finally {
                if (active && current === request) setLoading(false)
            }
        }
        map.on('click', inspect)
        return () => {
            active = false
            map.off('click', inspect)
        }
    }, [map, layer, enabled])

    return { inspection, loading: enabled && loading, error: enabled ? error : null }
}
