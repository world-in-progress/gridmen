import DefaultTemplate from "../default"
import { IResourceNode } from "../scene/iscene"
import { IViewContext } from "../views/IViewContext"
import SchemaCheck from "./schemaCheck"
import SchemaCreation from "./schemaCreation"
import SchemaEdit from "./schemaEdit"

export default class SchemaTemplate extends DefaultTemplate {
    static templateName: string = 'schema'

    static viewModels = {
        'MapView': {
            check: SchemaTemplate.checkMapView,
            create: SchemaTemplate.creationMapView,
            edit: SchemaTemplate.editMapView
        }
    }

    static checkMapView(nodeSelf: IResourceNode, context: IViewContext): Function {
        return () => SchemaCheck({ context })
    }
    static creationMapView(nodeSelf: IResourceNode, context: IViewContext): Function {
        return () => SchemaCreation({ context })
    }
    static editMapView(nodeSelf: IResourceNode, context: IViewContext): Function {
        return () => SchemaEdit({ context })
    }
}