import MapView from "@/views/mapView/mapView"
import GridTemplate from "@/template/grid/grid"
import PatchTemplate from "@/template/patch/patch"
import TableView from "@/views/tableView/tableView"
import SchemaTemplate from "@/template/schema/schema"
import DefaultTemplate from "@/template/default/default"
import DefaultView from "@/views/defaultView/defaultView"
import MapViewComponent from "@/views/mapView/mapViewComponent"
import TableViewComponent from "@/views/tableView/tableViewComponent"
import VectorTemplate from "@/template/vector/vector"

export interface NodeTemplateFunctionSet {
    check: Function | null
    create: Function | null
    edit: Function | null
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
            [DefaultTemplate.templateName]: {
                check: DefaultTemplate.checkMapView,
                create: DefaultTemplate.creationMapView,
                edit: DefaultTemplate.editMapView
            },
            [SchemaTemplate.templateName]: {
                check: SchemaTemplate.checkMapView,
                create: SchemaTemplate.creationMapView,
                edit: SchemaTemplate.editMapView
            },
            [PatchTemplate.templateName]: {
                check: PatchTemplate.checkMapView,
                create: PatchTemplate.creationMapView,
                edit: PatchTemplate.editMapView
            },
            [GridTemplate.templateName]: {
                check: GridTemplate.checkMapView,
                create: GridTemplate.creationMapView,
                edit: GridTemplate.editMapView
            },
            [VectorTemplate.templateName]: {
                check: VectorTemplate.checkMapView,
                create: VectorTemplate.creationMapView,
                edit: VectorTemplate.editMapView
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