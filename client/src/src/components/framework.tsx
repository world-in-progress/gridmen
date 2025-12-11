import { useCallback, useEffect, useReducer, useState } from "react"
import SettingView from "./settingView/settingView"
import { ICON_REGISTRY } from "@/registry/iconRegistry"
import { IResourceNode } from "@/template/scene/iscene"
import IconBar, { IconBarClickHandlers } from "./iconBar"
import ResourceTreeComponent from "./resourceTree/resourceTree"
import { ResourceNode, ResourceTree } from "@/template/scene/scene"
import MapViewComponent from "@/views/mapView/mapViewComponent"
import TableViewComponent from "@/views/tableView/tableViewComponent"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { useSettingStore } from "@/store/storeSet"

export default function Framework() {

    const [triggerFocus, setTriggerFocus] = useState(0)
    const [activeIconID, setActiveIconID] = useState('map-view')

    const [privateTree, setPrivateTree] = useState<ResourceTree | null>(null)
    const [publicTree, setPublicTree] = useState<ResourceTree | null>(null)
    const [focusNode, setFocusNode] = useState<IResourceNode | null>(null)
    const publicIP = useSettingStore(state => state.publicIP)

    const [, triggerRepaint] = useReducer(x => x + 1, 0)

    const iconClickHandlers: IconBarClickHandlers = {}
    ICON_REGISTRY.forEach(icon => {
        iconClickHandlers[icon.id] = (iconID: string) => {
            setActiveIconID(iconID)
        }
    })

    const handleNodeMenuOpen = useCallback((node: IResourceNode, menuItem: any) => {
        console.log('menu open node', node, menuItem)

        if (privateTree === null || publicTree === null) return

        const treeOfNode = node.tree as ResourceTree

        if (privateTree) privateTree.selectedNode = null
        if (publicTree) publicTree.selectedNode = null
        treeOfNode.selectedNode = node

        node.template?.handleMenuOpen(node, menuItem)
    }, [privateTree, publicTree])

    const handleNodeRemove = useCallback((node: IResourceNode) => {
        console.log('remove node', node)

        if (privateTree === null || publicTree === null) return

        const _node = node as ResourceNode
        const tree = _node.tree as ResourceTree

        publicTree.selectedNode = null
        privateTree.selectedNode = null

        if (focusNode && focusNode.id === _node.id) {
            if (_node.parent) {
                tree.selectedNode = _node.parent
                tree.editingNodeIds.has(_node.parent.id) && setFocusNode(_node.parent)
            }
            else setFocusNode(null)
            setTriggerFocus(prev => prev + 1)
        }
        else if (focusNode && focusNode.id !== _node.id) {
            console.debug(`currently focused node ${focusNode.id} is not the removed node ${_node.id}, reselecting it`);
            (focusNode.tree as ResourceTree).selectedNode = focusNode
            setFocusNode(focusNode)
            setTriggerFocus(prev => prev + 1)
        }
    }, [focusNode, publicTree, privateTree])

    const handleNodeClick = useCallback((node: IResourceNode) => {
        const _node = node as ResourceNode

        if (privateTree === null || publicTree === null) return
        privateTree.selectedNode = null
        publicTree.selectedNode = null
        _node.tree.selectedNode = _node
    }, [privateTree, publicTree])

    const handleNodeDoubleClick = useCallback((node: IResourceNode) => {
        const _node = node as ResourceNode

        if (privateTree === null || publicTree === null) return
        privateTree.selectedNode = null
        publicTree.selectedNode = null

        _node.tree.selectedNode = _node

    }, [privateTree, publicTree])

    useEffect(() => {
        const initTree = async () => {
            try {
                /// PRIVATE ///
                const _privateTree = await ResourceTree.create()
                _privateTree.subscribe(triggerRepaint)
                setPrivateTree(_privateTree)

                /// PUBLIC ///
                // const _publicTree = await ResourceTree.create(publicIP!)
                // _publicTree.subscribe(triggerRepaint)
                // setPublicTree(_publicTree)

            } catch (error) {
                console.error('Failed to initialize tree:', error)
            }
        }
        initTree()
    }, [publicIP])

    // 获取当前选中节点的 templateName，默认为 'default'
    const getCurrentTemplateName = (): string => {
        const selectedNode = privateTree?.selectedNode || publicTree?.selectedNode
        return selectedNode?.template_name || 'default'
    }

    const renderActiveView = () => {
        const currentTemplateName = getCurrentTemplateName()
        switch (activeIconID) {
            case 'map-view':
                return <MapViewComponent templateName={currentTemplateName} />
            case 'table-view':
                return <TableViewComponent />
            case 'settings':
                return <SettingView />
            default:
                return <MapViewComponent templateName={currentTemplateName} />
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
                        privateTree={privateTree}
                        publicTree={publicTree}
                        focusNode={focusNode}
                        triggerFocus={triggerFocus}
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
