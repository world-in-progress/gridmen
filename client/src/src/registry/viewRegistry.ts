import SchemaTemplate from "@/template/schema/schema"
import MapView from "@/template/views/mapView/mapView"
import { IResourceNode } from "@/template/scene/iscene"
import TableView from "@/template/views/tableView/tableView"
import { IViewContext } from "@/template/views/IViewContext"
import DefaultView from "@/template/views/defaultView/defaultView"
import MapViewComponent from "@/template/views/mapView/mapViewComponent"
import TableViewComponent from "@/template/views/tableView/tableViewComponent"

export interface NodeTemplateFunctionSet {
    check: ((nodeSelf: IResourceNode, context: IViewContext) => Function) | null
    create: ((nodeSelf: IResourceNode, context: IViewContext) => Function) | null
    edit: ((nodeSelf: IResourceNode, context: IViewContext) => Function) | null
}

interface ViewContent {
    component: React.ComponentType<any> | any
    viewModels: {
        [templateName: string]: NodeTemplateFunctionSet
    } | null
}

const _VIEW_REGISTRY: Record<string, ViewContent> = {
    [DefaultView.classKey]: {
        component: DefaultView,
        viewModels: null
    },
    [MapView.classKey]: {
        component: MapViewComponent,
        viewModels: {
            [SchemaTemplate.templateName]: {
                check: SchemaTemplate.checkViewModel,
                create: SchemaTemplate.creationViewModel,
                edit: SchemaTemplate.editViewModel
            }
        }
    },
    [TableView.classKey]: {
        component: TableViewComponent,
        viewModels: null
    }
}

export const VIEW_REGISTRY = new Proxy(_VIEW_REGISTRY, {
    get(target, prop: string) {
        return target[prop] || DefaultView
    }
})