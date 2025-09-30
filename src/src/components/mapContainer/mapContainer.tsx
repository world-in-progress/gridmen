import store from '@/store'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import MapboxDraw from '@mapbox/mapbox-gl-draw'
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css'
import { ISceneNode } from '@/core/scene/iscene'
import { useEffect, useRef, forwardRef } from 'react'
// @ts-expect-error no declare file for rectangle mode
import DrawRectangle from 'mapbox-gl-draw-rectangle-mode'
import SnapRectangleMode from './snapRectangleMode'
import { calculateRectangleCoordinates } from './utils'
import CustomLayerGroup from './customLayerGroup'
import {
    SnapPolygonMode,
    SnapPointMode,
    SnapLineMode,
    SnapModeDrawStyles,
    SnapDirectSelect,
} from "mapbox-gl-draw-snap-mode"

const initialLongitude = 114.051537
const initialLatitude = 22.446937
const initialZoom = 11
const maxZoom = 22

export interface DrawCreateEvent {
    features: Array<GeoJSON.Feature>
    type: string
}

export interface MapContainerProps {
    style?: string
    node: ISceneNode | null
    color?: string | null
}

const debounce = (func: (...args: any[]) => void, delay: number) => {
    let timeoutId: NodeJS.Timeout
    return (...args: any[]) => {
        clearTimeout(timeoutId)
        timeoutId = setTimeout(() => {
            // func(...args)
        }, delay)
    }
}

export const MapContainer = forwardRef<MapboxDraw, MapContainerProps>((props, ref) => {
    const { style, node, color } = props
    const mapWrapperRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        mapboxgl.accessToken = import.meta.env.VITE_MAP_TOKEN
        let mapInstance: mapboxgl.Map
        let resizer: ResizeObserver | null = null
        let drawInstance: MapboxDraw | null = null
        let isProcessingDrawEvent = false

        const handleDrawCreate = (e: any) => {
            if (isProcessingDrawEvent) return

            isProcessingDrawEvent = true
            try {
                if (e.features && e.features.length > 0) {
                    const feature = e.features[0];
                    if (drawInstance && drawInstance.getMode() === 'draw_rectangle' && feature.geometry.type === 'Polygon') {
                        const coordinates = calculateRectangleCoordinates(feature)
                        const drawCompleteEvent = new CustomEvent('rectangle-draw-complete', {
                            detail: { coordinates }
                        })
                        document.dispatchEvent(drawCompleteEvent)
                        if (drawInstance) {
                            drawInstance.changeMode('simple_select')
                        }
                    }
                }
            } finally {
                isProcessingDrawEvent = false
            }
        }

        if (mapWrapperRef.current) {
            mapInstance = new mapboxgl.Map({
                container: mapWrapperRef.current,
                style: 'mapbox://styles/mapbox/streets-v12',
                projection: 'globe',
                center: [initialLongitude, initialLatitude],
                zoom: initialZoom,
                maxZoom: maxZoom,
                attributionControl: false,
                boxZoom: false,
            })
            mapInstance.on('load', async () => {
                const layerGroup = new CustomLayerGroup()
                layerGroup.id = 'gridman-custom-layer-group'
                mapInstance.addLayer(layerGroup)
                store.set('clg', layerGroup)
            })
            store.set('map', mapInstance)

            mapInstance.on('style.load', () => {
                mapInstance.setFog({})
            })

            const drawColor = color || '#F06B00'
            const MapboxDrawConstructor = MapboxDraw as any
            drawInstance = new MapboxDrawConstructor({
                displayControlsDefault: false,
                boxSelect: false,
                controls: {
                    polygon: true,
                    line_string: true,
                    point: true,
                    trash: true,
                    combine_features: false,
                    uncombine_features: false
                },
                modes: {
                    ...MapboxDrawConstructor.modes,
                    draw_rectangle: SnapRectangleMode,  // 使用带吸附功能的矩形模式
                    draw_point: SnapPointMode,
                    draw_polygon: SnapPolygonMode,
                    draw_line_string: SnapLineMode,
                    direct_select: SnapDirectSelect,
                },
                // styles: [
                //     // Active point style
                //     {
                //         'id': 'gl-draw-point-active',
                //         'type': 'circle',
                //         'filter': ['all', ['==', '$type', 'Point'], ['==', 'active', 'true']],
                //         'paint': {
                //             'circle-radius': 7,
                //             'circle-color': drawColor
                //         }
                //     },
                //     // Inactive point style
                //     {
                //         'id': 'gl-draw-point',
                //         'type': 'circle',
                //         'filter': ['all', ['==', '$type', 'Point'], ['==', 'active', 'false']],
                //         'paint': {
                //             'circle-radius': 5,
                //             'circle-color': drawColor
                //         }
                //     },
                //     // Line style
                //     {
                //         'id': 'gl-draw-line',
                //         'type': 'line',
                //         'filter': ['all', ['==', '$type', 'LineString'], ['!=', 'mode', 'static']],
                //         'layout': {
                //             'line-cap': 'round',
                //             'line-join': 'round'
                //         },
                //         'paint': {
                //             'line-color': drawColor,
                //             'line-width': 2,
                //             ...(!color ? { 'line-dasharray': [2, 2] } : {})
                //         }
                //     },
                //     // Polygon fill style
                //     {
                //         'id': 'gl-draw-polygon-fill',
                //         'type': 'fill',
                //         'filter': ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
                //         'paint': {
                //             'fill-color': drawColor,
                //             'fill-outline-color': drawColor,
                //             ...(color ? { 'fill-opacity': 0.3 } : { 'fill-opacity': 0.1 })
                //         }
                //     },
                //     // Polygon outline style
                //     {
                //         'id': 'gl-draw-polygon-stroke',
                //         'type': 'line',
                //         'filter': ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
                //         'layout': {
                //             'line-cap': 'round',
                //             'line-join': 'round'
                //         },
                //         'paint': {
                //             'line-color': drawColor,
                //             'line-width': 2,
                //             ...(!color ? { 'line-dasharray': [2, 2] } : {})
                //         }
                //     },
                //     // Vertex style
                //     {
                //         'id': 'gl-draw-point-mid-point',
                //         'type': 'circle',
                //         'filter': ['all', ['==', '$type', 'Point'], ['==', 'meta', 'midpoint']],
                //         'paint': {
                //             'circle-radius': 4,
                //             'circle-color': drawColor
                //         }
                //     },
                //     // Vertex point style
                //     {
                //         'id': 'gl-draw-point-and-mid',
                //         'type': 'circle',
                //         'filter': ['all', ['==', '$type', 'Point'], ['==', 'meta', 'vertex']],
                //         'paint': {
                //             'circle-radius': 5,
                //             'circle-color': drawColor
                //         }
                //     },
                // ],
                styles: SnapModeDrawStyles,
                userProperties: true,
                // Config snapping features
                snap: true,
                snapOptions: {
                    snapPx: 15, // 吸附像素距离
                    snapToMidPoints: true, // 吸附到中点
                    snapVertexPriorityDistance: 0.0025, // 顶点优先距离
                    snapGetFeatures: (map: any, draw: any) => {
                        const features: any[] = []
                        
                        // 添加已绘制的要素
                        features.push(...draw.getAll().features)
                        
                        // 查询所有已渲染的要素，特别是patch bounds图层
                        try {
                            const renderedFeatures = map.queryRenderedFeatures()
                            const boundLayers = renderedFeatures.filter((feature: any) => {
                                return feature.sourceLayer === 'bounds-source' || 
                                       (feature.source && typeof feature.source === 'string' && 
                                        feature.source.includes('bounds-source'))
                            })
                            features.push(...boundLayers)
                        } catch (e) {
                            console.warn('Error querying rendered features for snap:', e)
                        }
                        
                        return features
                    }
                },
                guides: true,
            })
            store.set('mapDraw', drawInstance)

            mapInstance.addControl(drawInstance!, 'top-right')
            
            // 添加snap控制按钮和矩形绘制按钮
            const addSnapControls = () => {
                // 创建snap控制容器
                const snapControlsContainer = document.createElement('div')
                snapControlsContainer.className = 'mapboxgl-ctrl mapboxgl-ctrl-group snap-controls'
                snapControlsContainer.style.cssText = `
                    position: absolute;
                    top: 10px;
                    left: 10px;
                    background: white;
                    border-radius: 4px;
                    box-shadow: 0 0 10px rgba(0,0,0,0.1);
                    padding: 8px;
                    font-size: 12px;
                    z-index: 1000;
                `

                // 矩形绘制按钮
                const rectangleButton = document.createElement('button')
                rectangleButton.textContent = '⬜ Rectangle'
                rectangleButton.style.cssText = `
                    display: block;
                    width: 100%;
                    margin-bottom: 8px;
                    padding: 4px 8px;
                    border: 1px solid #ccc;
                    border-radius: 3px;
                    background: white;
                    cursor: pointer;
                    font-size: 12px;
                `
                rectangleButton.addEventListener('click', () => {
                    if (drawInstance) {
                        drawInstance.changeMode('draw_rectangle')
                    }
                })
                rectangleButton.addEventListener('mouseenter', () => {
                    rectangleButton.style.background = '#f0f0f0'
                })
                rectangleButton.addEventListener('mouseleave', () => {
                    rectangleButton.style.background = 'white'
                })

                // Snap when draw 按钮
                const snapToggle = document.createElement('label')
                snapToggle.style.cssText = `
                    display: block;
                    margin-bottom: 8px;
                    cursor: pointer;
                    user-select: none;
                `
                const snapCheckbox = document.createElement('input')
                snapCheckbox.type = 'checkbox'
                snapCheckbox.checked = true
                snapCheckbox.style.marginRight = '6px'
                snapCheckbox.addEventListener('change', (e) => {
                    const target = e.target as HTMLInputElement
                    if (drawInstance) {
                        // 动态更新snap配置
                        ;(drawInstance as any).options.snap = target.checked
                    }
                })
                snapToggle.appendChild(snapCheckbox)
                snapToggle.appendChild(document.createTextNode('Snap when draw'))

                // Show guides 按钮
                const guidesToggle = document.createElement('label')
                guidesToggle.style.cssText = `
                    display: block;
                    cursor: pointer;
                    user-select: none;
                `
                const guidesCheckbox = document.createElement('input')
                guidesCheckbox.type = 'checkbox'
                guidesCheckbox.checked = true
                guidesCheckbox.style.marginRight = '6px'
                guidesCheckbox.addEventListener('change', (e) => {
                    const target = e.target as HTMLInputElement
                    if (drawInstance) {
                        // 动态更新guides配置
                        ;(drawInstance as any).options.guides = target.checked
                    }
                })
                guidesToggle.appendChild(guidesCheckbox)
                guidesToggle.appendChild(document.createTextNode('Show guides'))

                snapControlsContainer.appendChild(rectangleButton)
                snapControlsContainer.appendChild(snapToggle)
                snapControlsContainer.appendChild(guidesToggle)

                // 添加到地图容器
                if (mapWrapperRef.current) {
                    mapWrapperRef.current.appendChild(snapControlsContainer)
                }
            }

            // 等待地图加载完成后添加控件
            if (mapInstance.loaded()) {
                addSnapControls()
            } else {
                mapInstance.on('load', addSnapControls)
            }
            
            // 默认进入简单选择模式，不自动开启绘制
            // drawInstance!.changeMode("simple_select");
            mapInstance.on('draw.create', handleDrawCreate)

            const currentMapInstance = mapInstance
            resizer = new ResizeObserver(
                debounce(() => {
                    currentMapInstance?.resize()
                }, 100)
            )
            resizer.observe(mapWrapperRef.current)
        }

        return () => {
            if (resizer && mapWrapperRef.current) {
                // eslint-disable-next-line react-hooks/exhaustive-deps
                resizer.unobserve(mapWrapperRef.current)
                resizer.disconnect()
            }
            
            if (mapWrapperRef.current) {
                const snapControls = mapWrapperRef.current.querySelector('.snap-controls')
                if (snapControls) {
                    snapControls.remove()
                }
            }
            
            if (mapInstance) {
                if (drawInstance) {
                    mapInstance.removeControl(drawInstance)
                    mapInstance.off('draw.create', handleDrawCreate)
                }
                mapInstance.remove()
                store.set('map', null)
                store.set('mapDraw', null)
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [color])

    return (
        <div className={style ?? 'relative w-full h-full'} ref={mapWrapperRef} />
    )
})

export default MapContainer