import DefaultTemplate from "../default/default"
import { IResourceNode } from "../scene/iscene"
import { IViewContext } from "@/views/IViewContext"
import SchemaCheck from "./schemaCheck"
import SchemaCreation from "./schemaCreation"
import SchemaEdit from "./schemaEdit"
import { ResourceTree } from "../scene/scene"

export default class SchemaTemplate extends DefaultTemplate {
    static templateName: string = 'schema'

    viewModels = {
        'MapView': {
            check: SchemaTemplate.checkMapView,
            create: SchemaTemplate.creationMapView,
            edit: SchemaTemplate.editMapView
        }
    }

    checkMapView(node: IResourceNode, context: IViewContext): Function {
        return () => SchemaCheck({ context })
    }
    creationMapView(node: IResourceNode, tree: ResourceTree, context: IViewContext): Function {
        return () => SchemaCreation({ node, tree, context })
    }
    editMapView(nodeSelf: IResourceNode, context: IViewContext): Function {
        return () => SchemaEdit({ context })
    }
}