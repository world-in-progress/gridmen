import DefaultTemplate from "../default/default"
import { IResourceNode } from "../scene/iscene"
import { IViewContext } from "../views/IViewContext"

export default class GridTemplate extends DefaultTemplate {
    static templateName: string = 'grid'

    static viewModels = {
        'MapView': {
            check: GridTemplate.checkMapView,
            create: GridTemplate.creationMapView,
            edit: GridTemplate.editMapView
        }
    }

    static checkMapView(nodeSelf: IResourceNode, context: IViewContext): Function {
        return () => null
    }
    static creationMapView(nodeSelf: IResourceNode, context: IViewContext): Function {
        return () => null
    }
    static editMapView(nodeSelf: IResourceNode, context: IViewContext): Function {
        return () => null
    }
}