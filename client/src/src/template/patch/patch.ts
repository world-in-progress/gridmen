import DefaultTemplate from "../default/default";
import { IResourceNode } from "../scene/iscene";
import { IViewContext } from "../views/IViewContext";

export default class PatchTemplate extends DefaultTemplate {
    static templateName: string = 'patch'

    static viewModels = {
        'MapView': {
            check: PatchTemplate.checkMapView,
            create: PatchTemplate.creationMapView,
            edit: PatchTemplate.editMapView
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