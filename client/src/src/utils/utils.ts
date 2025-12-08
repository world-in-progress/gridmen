import proj4 from 'proj4'
import mapboxgl from 'mapbox-gl'
import { twMerge } from "tailwind-merge"
import { clsx, type ClassValue } from "clsx"
import * as apis from '@/template/noodle/apis'
import MapboxDraw from '@mapbox/mapbox-gl-draw'

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export const convertPointCoordinate = async (originPoint: [number, number], fromEPSG: number, toEPSG: number): Promise<[number, number] | null> => {
    const lon = originPoint[0]
    const lat = originPoint[1]

    const fromEPSGDefs = await apis.proj.getProj4Defs(fromEPSG)
    const toEPSGDefs = await apis.proj.getProj4Defs(toEPSG)

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

export const startDrawRectangle = (map: mapboxgl.Map, drawInstance: MapboxDraw) => {
    if (!map || !drawInstance) return

    try {
        drawInstance.deleteAll()
        drawInstance.changeMode('draw_rectangle')
        return true
    } catch (error) {
        console.error('Error starting draw rectangle:', error)
        return false
    }
}

export const stopDrawRectangle = (map: mapboxgl.Map, drawInstance: MapboxDraw) => {
    if (!map || !drawInstance) return

    try {
        drawInstance.changeMode('simple_select')
    } catch (error) {
        console.error('Error stopping draw rectangle:', error)
    }
}

export const addMapPatchBounds = (
    map: mapboxgl.Map,
    bounds: [number, number, number, number], id?: string,
    fit?: boolean,
    options?: {
        fillColor?: string,
        lineColor?: string,
        opacity?: number,
        lineWidth?: number,
    }
) => {
    const sourceId = id ? `bounds-source-${id}` : 'bounds-source'
    const fillLayerId = id ? `bounds-fill-${id}` : 'bounds-fill'
    const outlineLayerId = id ? `bounds-outline-${id}` : 'bounds-outline'

    const addBounds = () => {
        // Remove existing layers/source with the same ID before adding new ones
        if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId)
        if (map.getLayer(outlineLayerId)) map.removeLayer(outlineLayerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)

        const boundsData = {
            type: 'Feature',
            properties: {},
            geometry: {
                type: 'Polygon',
                coordinates: [[
                    [bounds[0], bounds[1]],
                    [bounds[2], bounds[1]],
                    [bounds[2], bounds[3]],
                    [bounds[0], bounds[3]],
                    [bounds[0], bounds[1]]
                ]]
            }
        }

        map.addSource(sourceId, {
            type: 'geojson',
            data: boundsData as GeoJSON.Feature<GeoJSON.Polygon>
        })

        const defaultFillColor = id === 'adjusted-bounds' ? '#00FF00' : '#00A8C2'
        const defaultLineColor = id === 'adjusted-bounds' ? '#FF1A00' : '#0072FF'
        const defaultOpacity = id === 'adjusted-bounds' ? 0.1 : 0.2
        const defaultLineWidth = 2

        const fillColor = options?.fillColor || defaultFillColor
        const lineColor = options?.lineColor || defaultLineColor
        const opacity = options?.opacity !== undefined ? options.opacity : defaultOpacity
        const lineWidth = options?.lineWidth !== undefined ? options.lineWidth : defaultLineWidth

        // Inner filled layer
        map.addLayer({
            id: fillLayerId,
            type: 'fill',
            source: sourceId,
            layout: {},
            paint: {
                'fill-color': fillColor,
                'fill-opacity': opacity
            }
        })

        // Outline layer
        map.addLayer({
            id: outlineLayerId,
            type: 'line',
            source: sourceId,
            layout: {},
            paint: {
                'line-color': lineColor,
                'line-width': lineWidth
            }
        })

        // Fly to bounds
        if (fit !== false) {
            map.fitBounds([
                [bounds[0], bounds[1]],
                [bounds[2], bounds[3]]
            ], {
                padding: 50,
                duration: 1000
            })
        }
    }

    if (map.isStyleLoaded()) {
        addBounds()
    } else {
        const timeoutId = setTimeout(() => {
            if (map.isStyleLoaded()) {
                addBounds()
            } else {
                // Try again with a longer delay
                const retryId = setTimeout(() => {
                    addBounds()
                }, 100)
                map.once('style.load', () => {
                    clearTimeout(retryId)
                    addBounds()
                })
            }
        }, 100)
    }
}

export const debounce = <F extends (...args: any[]) => any>(
    func: F,
    delay: number
): (...args: Parameters<F>) => Promise<ReturnType<F>> => {
    let timeoutId: NodeJS.Timeout | null = null;

    return (...args: Parameters<F>) => {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }

        return new Promise<ReturnType<F>>((resolve) => {
            timeoutId = setTimeout(() => {
                const result = func(...args);
                timeoutId = null;
                resolve(result);
            }, delay);
        });
    };
};