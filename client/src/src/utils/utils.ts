import proj4 from 'proj4'
import mapboxgl from 'mapbox-gl'
import { twMerge } from "tailwind-merge"
import { clsx, type ClassValue } from "clsx"
import { getProj4Defs } from '@/template/noodle/proj'

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export const convertCoordinate = async (originPoint: [number, number], fromEPSG: number, toEPSG: number): Promise<[number, number] | null> => {
    const lon = originPoint[0]
    const lat = originPoint[1]

    const fromEPSGDefs = await getProj4Defs(fromEPSG)
    const toEPSGDefs = await getProj4Defs(toEPSG)

    if (!lon || !lat || !fromEPSG || !toEPSG) return null

    try {
        if (fromEPSGDefs) {
            proj4.defs(`EPSG:${fromEPSG}`, fromEPSGDefs)
        }

        if (toEPSGDefs) {
            proj4.defs(`EPSG:${toEPSG}`, toEPSGDefs)
        }

        const convertedPoint = proj4(`EPSG:${fromEPSG}`, `EPSG:${toEPSG}`, originPoint)
        return convertedPoint
    } catch (error) {
        console.error('Error converting coordinate:', error)
        return null
    }
}

export const clearMapMarkers = (): void => {
    const markers = document.getElementsByClassName('mapboxgl-marker')
    if (markers.length > 0) {
        Array.from(markers).forEach((marker) => {
            marker.remove()
        })
    }
}

export const addMapMarker = (map: mapboxgl.Map, coords: [number, number], options?: mapboxgl.MarkerOptions): void => {

    if (!map || !map.getCanvas() || !coords || coords.length < 2) return

    const marker = new mapboxgl.Marker(options)
        .setLngLat([coords[0], coords[1]])
        .addTo(map)
}

export const pickCoordsFromMap = (map: mapboxgl.Map, option?: mapboxgl.MarkerOptions, callback?: (marker: mapboxgl.Marker) => void): (() => void) => {
    if (map.getCanvas()) map.getCanvas().style.cursor = 'crosshair'

    const handleMapClick = (e: mapboxgl.MapMouseEvent) => {
        if (map.getCanvas()) map.getCanvas().style.cursor = ''

        const marker = new mapboxgl.Marker({ ...option, anchor: 'center' })
            .setLngLat(e.lngLat)
            .addTo(map)

        callback && callback(marker)
    }

    map.once('click', handleMapClick)

    return () => {
        map.off('click', handleMapClick)
        if (map.getCanvas()) map.getCanvas().style.cursor = ''
    }
}
