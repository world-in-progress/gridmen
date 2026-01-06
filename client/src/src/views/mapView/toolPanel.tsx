import { MapViewContext } from './mapView'
import { IResourceNode } from '@/template/scene/iscene'
import { useToolPanelStore } from '@/store/storeSet'

interface NodeTemplateFunctionSet {
    check: Function | null
    create: Function | null
    edit: Function | null
}

interface ToolPanelProps {
    viewModels: {
        [templateName: string]: NodeTemplateFunctionSet
    } | null
    mapContainer: mapboxgl.Map | null
    templateName?: string
    selectedNode?: IResourceNode | null
}

export default function ToolPanel({ viewModels, mapContainer, templateName = 'default', selectedNode = null }: ToolPanelProps) {
    const activeTab = useToolPanelStore((s) => s.activeTab)

    if (!viewModels) {
        return (
            <div className="flex h-full w-full items-center justify-center bg-gray-800 text-white">
                No Tool Panel Available
            </div>
        )
    }

    const currentViewModel = viewModels[templateName] || viewModels['default']

    if (!currentViewModel) {
        return (
            <div className="flex h-full w-full items-center justify-center bg-gray-800 text-white">
                No View Model Found for template: {templateName}
            </div>
        )
    }

    const context: MapViewContext = {
        map: mapContainer,
        drawInstance: null,
        setMap: (map: mapboxgl.Map) => {
            console.log('setMap', map)
        },
        setDrawInstance: (drawInstance: MapboxDraw) => {
            console.log('setDrawInstance', drawInstance)
        }
    }

    const CheckComponent = currentViewModel.check ? currentViewModel.check(selectedNode || null, context) : null
    const CreateComponent = currentViewModel.create ? currentViewModel.create(selectedNode || null, context) : null
    const EditComponent = currentViewModel.edit ? currentViewModel.edit(selectedNode || null, context) : null

    const ActiveComponent =
        activeTab === 'edit'
            ? (EditComponent || CreateComponent)
            : activeTab === 'check'
                ? (CheckComponent || CreateComponent)
                : CreateComponent

    return (
        <div className="flex flex-col h-full w-full bg-gray-900">
            {ActiveComponent ? <ActiveComponent /> : null}
        </div>
    )
}
