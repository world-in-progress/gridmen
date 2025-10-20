import { useEffect, useRef, forwardRef, useState, useCallback } from 'react'
import MapView from './mapView'
import mapboxgl from 'mapbox-gl'
import ToolPanel from './toolPanel'
import LayerGroup from './layerGroup'
import { VIEW_REGISTRY } from '@/registry/viewRegistry'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"


const initialLongitude = 114.051537
const initialLatitude = 22.446937
const initialZoom = 11
const maxZoom = 22

interface MapContainerProps {
    onMapLoad?: (map: mapboxgl.Map) => void
}

const debounce = (func: (...args: any[]) => void, delay: number) => {
    let timeoutId: NodeJS.Timeout
    return (...args: any[]) => {
        clearTimeout(timeoutId)
        timeoutId = setTimeout(() => {
            func(...args)
        }, delay)
    }
}

const MapContainer = forwardRef<HTMLDivElement, MapContainerProps>(({ onMapLoad }, ref) => {
    const mapWrapperRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        mapboxgl.accessToken = import.meta.env.VITE_MAP_TOKEN
        let mapInstance: mapboxgl.Map
        let resizer: ResizeObserver | null = null
        const currentMapWrapper = mapWrapperRef.current

        if (currentMapWrapper) {
            mapInstance = new mapboxgl.Map({
                container: currentMapWrapper,
                style: 'mapbox://styles/mapbox/streets-v12',
                projection: 'globe',
                center: [initialLongitude, initialLatitude],
                zoom: initialZoom,
                maxZoom: maxZoom,
                attributionControl: false,
                boxZoom: false,
            })

            mapInstance.on('style.load', () => {
                mapInstance.setFog({})
            })

            // 调用回调函数，将 map 实例传递给父组件
            if (onMapLoad) {
                onMapLoad(mapInstance)
            }

            const currentMapInstance = mapInstance
            resizer = new ResizeObserver(
                debounce(() => {
                    currentMapInstance?.resize()
                }, 100)
            )
            resizer.observe(currentMapWrapper)
        }

        return () => {
            if (resizer && currentMapWrapper) {
                resizer.unobserve(currentMapWrapper)
                resizer.disconnect()
            }
            if (mapInstance) {
                mapInstance.remove()
            }
        }

    }, [onMapLoad])

    return (
        <div className="flex h-full items-center justify-center">
            <div className='relative w-full h-full' ref={mapWrapperRef} />
        </div>
    )
})

export default function MapViewComponent() {
    // 存储 map 实例的 state
    const [mapInstance, setMapInstance] = useState<mapboxgl.Map | null>(null)

    // 从 viewRegistry 中获取当前视图的 viewModels
    const viewConfig = VIEW_REGISTRY[MapView.classKey]
    const viewModels = viewConfig?.viewModels || null

    // useCallback 避免无限循环
    const handleMapLoad = useCallback((map: mapboxgl.Map) => {
        setMapInstance(map)
    }, [])

    return (
        <ResizablePanelGroup
            direction="horizontal"
            className="h-full w-full text-white "
        >
            <ResizablePanel defaultSize={13}>
                <LayerGroup />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={63}>
                <MapContainer onMapLoad={handleMapLoad} />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={24}>
                <ToolPanel
                    viewModels={viewModels}
                    mapContainer={mapInstance}
                />
            </ResizablePanel>
        </ResizablePanelGroup >
    )
}
