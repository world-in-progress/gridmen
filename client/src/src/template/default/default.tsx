import DefaultEdit from "./defaultEdit"
import { ITemplate } from "../iTemplate"
import DefaultCheck from "./defaultCheck"
import DefaultCreation from "./defaultCreation"
import { IResourceNode } from "../scene/iscene"
import { IViewContext } from "@/views/IViewContext"

export default class DefaultTemplate implements ITemplate {
    static templateName: string = 'default'
    templateName: string = DefaultTemplate.templateName

    static viewModels = {
        'MapView': {
            check: DefaultTemplate.checkMapView,
            create: DefaultTemplate.creationMapView,
            edit: DefaultTemplate.editMapView
        },
        'TableView': {
            check: DefaultTemplate.checkTableView,
            create: DefaultTemplate.creationTableView,
            edit: DefaultTemplate.editTableView
        }
    }

    static checkMapView(nodeSelf: IResourceNode, context: IViewContext): Function {
        return () => DefaultCheck()
    }

    static creationMapView(nodeSelf: IResourceNode, context: IViewContext): Function {
        return () => DefaultCreation()
    }

    static editMapView(nodeSelf: IResourceNode, context: IViewContext): Function {
        return () => DefaultEdit()
    }

    static checkTableView(nodeSelf: IResourceNode, context: IViewContext): Function {
        return () => null
    }

    static creationTableView(nodeSelf: IResourceNode, context: IViewContext): Function {
        return () => null
    }

    static editTableView(nodeSelf: IResourceNode, context: IViewContext): Function {
        return () => null
    }

    renderMenu(nodeSelf: IResourceNode, handleContextMenu: (node: IResourceNode, menuItem: any) => void): React.JSX.Element | null {
        return null
    }

    handleMenuOpen(nodeSelf: IResourceNode, menuItem: any): void { }
}