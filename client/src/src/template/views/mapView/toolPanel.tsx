import { useState } from 'react'
import { MapViewContext } from './mapView'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

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
}

export default function ToolPanel({ viewModels, mapContainer }: ToolPanelProps) {
    const [activeTab, setActiveTab] = useState<string>('create')

    // 如果没有 viewModels，显示空状态
    if (!viewModels) {
        return (
            <div className="flex h-full w-full items-center justify-center bg-gray-800 text-white">
                No Tool Panel Available
            </div>
        )
    }

    // 获取第一个 viewModel (通常是 Schema)
    const firstViewModel = Object.values(viewModels)[0]

    if (!firstViewModel) {
        return (
            <div className="flex h-full w-full items-center justify-center bg-gray-800 text-white">
                No View Model Found
            </div>
        )
    }

    // 创建 MapViewContext
    const context: MapViewContext = {
        map: mapContainer,
        setMap: (map: mapboxgl.Map) => {
            console.log('setMap', map)
        }
    }

    // 获取各个组件，传入 context
    const CheckComponent = firstViewModel.check ? firstViewModel.check(null, context) : null
    const CreateComponent = firstViewModel.create ? firstViewModel.create(null, context) : null
    const EditComponent = firstViewModel.edit ? firstViewModel.edit(null, context) : null

    return (
        <div className="flex flex-col h-full w-full bg-gray-900">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col gap-0">
                <TabsList className="flex-none w-full bg-gray-800 border-b border-gray-700 rounded-none h-auto 
                        [&_button]:cursor-pointer 
                        [&_button]:text-white 
                        [&_button:not([data-state=active])]:hover:bg-gray-700 
                        [&_button[data-state=active]]:text-black"
                >
                    {CheckComponent && (
                        <TabsTrigger value="check" className="flex-1">
                            Check
                        </TabsTrigger>
                    )}
                    {CreateComponent && (
                        <TabsTrigger value="create" className="flex-1">
                            Create
                        </TabsTrigger>
                    )}
                    {EditComponent && (
                        <TabsTrigger value="edit" className="flex-1">
                            Edit
                        </TabsTrigger>
                    )}
                </TabsList>


                {CheckComponent && (
                    <TabsContent value="check" className="flex-1 m-0 min-h-0 h-full">
                        <CheckComponent />
                    </TabsContent>
                )}
                {CreateComponent && (
                    <TabsContent value="create" className="flex-1 m-0 min-h-0 h-full">
                        <CreateComponent />
                    </TabsContent>
                )}
                {EditComponent && (
                    <TabsContent value="edit" className="flex-1 m-0 min-h-0 h-full">
                        <EditComponent />
                    </TabsContent>
                )}
            </Tabs>
        </div>
    )
}
