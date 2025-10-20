import proj4 from 'proj4'
import mapboxgl from 'mapbox-gl'
import { twMerge } from "tailwind-merge"
import { clsx, type ClassValue } from "clsx"

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

// TODO:此处应改为由后端接口提供EPSG定义
export const epsgDefinitions: Record<string, string> = {
    '4326': '+proj=longlat +datum=WGS84 +no_defs',
    '3857': '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs', // Web Mercator
    '2326': '+proj=tmerc +lat_0=22.3121333333333 +lon_0=114.178555555556 +k=1 +x_0=836694.05 +y_0=819069.8 +ellps=intl +towgs84=-162.619,-276.959,-161.764,0.067753,-2.243649,-1.158827,-1.094246 +units=m +no_defs', // Hong Kong 1980 Grid System
    '2433': '+proj=tmerc +lat_0=0 +lon_0=114 +k=1 +x_0=500000 +y_0=0 +ellps=intl +towgs84=-162.619,-276.959,-161.764,0.067753,-2.24365,-1.15883,-1.09425 +units=m +no_defs', // Hong Kong 1980 Grid System
}

export const convertCoordinate = (originPoint: [number, number], fromEPSG: number, toEPSG: number): [number, number] | null => {
    const lon = originPoint[0]
    const lat = originPoint[1]

    if (!lon || !lat || !fromEPSG || !toEPSG) return null

    try {
        if (epsgDefinitions[fromEPSG]) {
            proj4.defs(`EPSG:${fromEPSG}`, epsgDefinitions[fromEPSG])
        }

        if (epsgDefinitions[toEPSG]) {
            proj4.defs(`EPSG:${toEPSG}`, epsgDefinitions[toEPSG])
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
            // .setLngLat([e.lngLat.lng, e.lngLat.lat])
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
