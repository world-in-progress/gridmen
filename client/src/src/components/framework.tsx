import { useState } from "react"
import { ICON_REGISTRY } from "@/registry/iconRegistry"
import IconBar, { IconBarClickHandlers } from "./iconBar"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import MapViewComponent from "../template/views/mapView/mapViewComponent"
import TableViewComponent from "../template/views/tableView/tableViewComponent"
import SettingView from "./settingView/settingView"
import ResourceTree from "./resourceTree/resourceTree"

export default function Framework() {

    const [activeIconID, setActiveIconID] = useState('map-view')

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

    const iconClickHandlers: IconBarClickHandlers = {}
    ICON_REGISTRY.forEach(icon => {
        iconClickHandlers[icon.id] = (iconID: string) => {
            setActiveIconID(iconID)
        }
    })

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
                <ResizablePanel defaultSize={10}>
                    <ResourceTree />
                </ResizablePanel>
                <ResizableHandle className="opacity-0 hover:bg-blue-200" />
                <ResizablePanel defaultSize={90}>
                    {renderActiveView()}
                </ResizablePanel>
            </ResizablePanelGroup>
        </div>
    )
}
