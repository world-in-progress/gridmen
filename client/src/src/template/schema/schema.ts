import { IResourceNode } from "../scene/iscene"
import { IViewContext } from "../views/IViewContext"
import SchemaCheck from "./schemaCheck"
import SchemaCreation from "./schemaCreation"
import SchemaEdit from "./schemaEdit"

export default class Schema {
    static viewModelName = 'schema'

    static checkViewModel(nodeSelf: IResourceNode, context: IViewContext): Function {
        return () => SchemaCheck({ context })
    }
    static creationViewModel(nodeSelf: IResourceNode, context: IViewContext): Function {
        return () => SchemaCreation({ context })
    }
    static editViewModel(nodeSelf: IResourceNode, context: IViewContext): Function {
        return () => SchemaEdit({ context })
    }
}