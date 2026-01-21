import { Map } from 'mapbox-gl'
import CustomLayerGroup from './customLayerGroup'
import TopologyLayer from './TopologyLayer'

type TopologyLayerWithInitPromise = TopologyLayer & { __nh_initPromise?: Promise<void> }

export function getOrCreateTopologyLayer(
    clg: CustomLayerGroup,
    map: Map,
    layerId: string,
): TopologyLayer {
    const existing = clg.getLayerInstance(layerId) as TopologyLayer | null
    if (existing) return existing

    const layer = new TopologyLayer(map)
    layer.id = layerId
    clg.addLayer(layer)
    return layer
}

export async function ensureTopologyLayerInitialized(layer: TopologyLayer, map: Map): Promise<void> {
    const typed = layer as TopologyLayerWithInitPromise
    if (!typed.__nh_initPromise) {
        typed.__nh_initPromise = layer.initialize(map, map.painter.context.gl)
    }
    await typed.__nh_initPromise
}
