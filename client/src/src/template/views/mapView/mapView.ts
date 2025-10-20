import { IView } from "../defaultView/iViewNode"
import { IResourceNode } from "@/template/scene/iscene"
import { IViewContext } from "../IViewContext"

export default class MapView implements IView {
    name = 'mapView'
    children: string[] = []

    static classKey = 'mapView'
    semanticPath = 'mapView'

    viewModelFactory(): Function {
        return null as any
    }
}

export interface MapViewContext extends IViewContext {
    map: mapboxgl.Map | null
}
