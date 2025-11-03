import { useCallback, useEffect, useReducer, useState } from "react"
import { ICON_REGISTRY } from "@/registry/iconRegistry"
import IconBar, { IconBarClickHandlers } from "./iconBar"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import MapViewComponent from "../template/views/mapView/mapViewComponent"
import TableViewComponent from "../template/views/tableView/tableViewComponent"
import SettingView from "./settingView/settingView"
import ResourceTreeComponent from "./resourceTree/resourceTree"
import { ResourceTree } from "@/template/scene/scene"
import { IResourceNode } from "@/template/scene/iscene"

export default function Framework() {

    const [activeIconID, setActiveIconID] = useState('map-view')

    const [, triggerRepaint] = useReducer(x => x + 1, 0)

    const iconClickHandlers: IconBarClickHandlers = {}
    ICON_REGISTRY.forEach(icon => {
        iconClickHandlers[icon.id] = (iconID: string) => {
            setActiveIconID(iconID)
        }
    })

    const handleNodeMenuOpen = useCallback((node: IResourceNode) => {
        console.log('menu open node', node)
    }, [])

    const handleNodeRemove = useCallback((node: IResourceNode) => {
        console.log('remove node', node)
    }, [])

    const handleNodeClick = useCallback((node: IResourceNode) => {
        console.log('click node', node)
    }, [])

    const handleNodeDoubleClick = useCallback((node: IResourceNode) => {
        console.log('double click node', node)
    }, [])

    useEffect(() => {
        const initTree = async () => {
            try {
                const _privateTree = await ResourceTree.create()
                const _publicTree = await ResourceTree.create()

                _privateTree.subscribe(triggerRepaint)
                _publicTree.subscribe(triggerRepaint)
            } catch (error) {
                console.error('Failed to initialize tree:', error)
            }
        }
        initTree()
    }, [])

    const renderActiveView = () => {
        switch (activeIconID) {
            case 'map-view':
                return <MapViewComponent />
            case 'table-view':
                return <TableViewComponent />
            case 'settings':
                return <SettingView />
            default:
                return <MapViewComponent />
        }
    }



    return (
        <div className='w-screen h-screen bg-[#1E1E1E] flex'>
            <IconBar
                currentActiveId={activeIconID}
                clickHandlers={iconClickHandlers}
            />
            <ResizablePanelGroup
                direction="horizontal"
                className="h-full w-[98%] text-white"
            >
                <ResizablePanel defaultSize={11}>
                    <ResourceTreeComponent
                        onNodeMenuOpen={handleNodeMenuOpen}
                        onNodeRemove={handleNodeRemove}
                        onNodeClick={handleNodeClick}
                        onNodeDoubleClick={handleNodeDoubleClick}
                    />
                </ResizablePanel>
                <ResizableHandle className="opacity-0 hover:bg-blue-200" />
                <ResizablePanel defaultSize={89}>
                    {renderActiveView()}
                </ResizablePanel>
            </ResizablePanelGroup>
        </div>
    )
}
