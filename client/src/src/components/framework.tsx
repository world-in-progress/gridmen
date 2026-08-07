import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react"
import LoginPage from "./loginPage/loginPage"
import ResourceTreeComponent from "./resourceTree/resourceTree"
import SettingView from "./settingView/settingView"
import { ICON_REGISTRY } from "@/registry/iconRegistry"
import { IResourceNode } from "@/template/scene/iscene"
import IconBar, { IconBarClickHandlers } from "./iconBar"
import MapViewComponent from "@/views/mapView/mapViewComponent"
import { ResourceNode, ResourceTree } from "@/template/scene/scene"
import TableViewComponent from "@/views/tableView/tableViewComponent"
import { useSelectedNodeStore, useSettingStore, useToolPanelStore } from "@/store/storeSet"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom"
import Hello from "./helloPage/hello"
import { useRedirect } from "@/hooks/useRedirect"
import { RedirectTarget } from "@/registry/iconRegistry"

function FrameworkShell() {
    const location = useLocation()
    const navigate = useNavigate()

    const [triggerFocus, setTriggerFocus] = useState(0)
    const [activeIconID, setActiveIconID] = useState<RedirectTarget>('map-view')
    const [isLoggedIn, setIsLoggedIn] = useState(true)  // temporarily set to true for development

    const treeInitRef = useRef(false)
    const [privateTree, setPrivateTree] = useState<ResourceTree | null>(null)
    const [publicTree, setPublicTree] = useState<ResourceTree | null>(null)
    const [focusNode, setFocusNode] = useState<IResourceNode | null>(null)

    const publicIP = useSettingStore(state => state.publicIP)
    const { setSelectedNodeKey } = useSelectedNodeStore()

    const [, triggerRepaint] = useReducer(x => x + 1, 0)

    const { redirectTo } = useRedirect({ isLoggedIn, setActiveIconID })

    const handleIconClick = useCallback((iconID: string) => {
        switch (iconID) {
            case 'map-view':
            case 'table-view':
            case 'settings':
                redirectTo(iconID)
                return
            case 'user':
                navigate('/login')
                return
            default:
                return
        }
    }, [redirectTo, navigate])

    const iconClickHandlers: IconBarClickHandlers = useMemo(() => {
        const handlers: IconBarClickHandlers = {}
        ICON_REGISTRY.forEach(icon => {
            handlers[icon.id] = handleIconClick
        })
        return handlers
    }, [handleIconClick])

    const currentActiveId = useMemo(() => {
        const path = location.pathname
        if (path.startsWith('/framework')) return activeIconID
        if (path.startsWith('/login')) return 'user'
        return null
    }, [activeIconID, location.pathname])

    // Login route wrapper to perform navigation after login
    function LoginRoute({ onLogin }: { onLogin: () => void }) {
        const handleLogin = () => {
            onLogin()
            navigate('/framework')
        }
        return <LoginPage onLogin={handleLogin} />
    }

    const handleNodeMenuOpen = useCallback((node: IResourceNode, menuItem: any) => {
        if (privateTree === null && publicTree === null) return

        const treeOfNode = node.tree as ResourceTree

        // Decide which ToolPanel tab to switch to (if any)
        let nextTab: 'create' | 'check' | 'edit' | null = null
        if (typeof menuItem === 'string') {
            const key = menuItem.toLowerCase()
            if (key.includes('edit')) nextTab = 'edit'
            else if (key.includes('check')) nextTab = 'check'
            else if (key.includes('create')) nextTab = 'create'
        }

        const applySelection = () => {
            if (privateTree) privateTree.selectedNode = null
            if (publicTree) publicTree.selectedNode = null
            treeOfNode.selectedNode = node
            treeOfNode.notifyDomUpdate()
            setSelectedNodeKey(node.key)
        }

        const isDestructiveAction = (() => {
            if (typeof menuItem !== 'string') return false
            const key = menuItem.toLowerCase()
            return key.includes('delete')
        })()

        // Actions like "Copy" are operational (open dialog/export/etc) and should NOT
        // change selection or active ToolPanel tab, otherwise the UI may jump to the
        // previously active tab (often 'create' => GridCreation).
        const isNonNavigationalAction = (() => {
            if (typeof menuItem !== 'string') return false
            const key = menuItem.toLowerCase()
            return key.includes('copy') || key.includes('export')
        })()

        // IMPORTANT: If template action is async (e.g. linkNode -> sets lockId),
        // wait for it before applying selection + switching tabs, so we don't briefly render
        // this node under the previous tab (often 'create') and then jump again.
        const maybePromise = node.template?.handleMenuOpen(node, menuItem)
        const isThenable = !!maybePromise && typeof (maybePromise as any).then === 'function'

        // Destructive actions (and non-navigational actions like Copy) shouldn't change selection/tab;
        // selecting the node would briefly render its current tab (often 'create') which looks like a navigation jump.
        if (isDestructiveAction || isNonNavigationalAction) {
            if (isThenable) {
                ; (maybePromise as Promise<void>).catch((err) => {
                    console.error('handleMenuOpen failed:', err)
                })
            }
            return
        }

        if (isThenable) {
            ; (maybePromise as Promise<void>)
                .then(() => {
                    applySelection()
                    if (nextTab) useToolPanelStore.getState().setActiveTab(nextTab)
                })
                .catch((err) => {
                    console.error('handleMenuOpen failed:', err)
                })
            return
        }

        // Sync path: apply selection immediately.
        applySelection()
        if (nextTab) useToolPanelStore.getState().setActiveTab(nextTab)
    }, [privateTree, publicTree])

    const handleNodeRemove = useCallback((node: IResourceNode) => {

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
        if (privateTree === null || publicTree === null) return
        const _node = node as ResourceNode

        privateTree.selectedNode = null
        publicTree.selectedNode = null
        _node.tree.selectedNode = _node
        setSelectedNodeKey(_node.key)
    }, [privateTree, publicTree, setSelectedNodeKey])

    const handleNodeDoubleClick = useCallback((node: IResourceNode) => {
        const _node = node as ResourceNode

        if (privateTree === null || publicTree === null) return
        privateTree.selectedNode = null
        publicTree.selectedNode = null

        _node.tree.selectedNode = _node
        setSelectedNodeKey(_node.key)

    }, [privateTree, publicTree, setSelectedNodeKey])

    useEffect(() => {
        // Only initialize resource trees when actually entering /framework and logged in.
        if (!isLoggedIn) return
        if (!location.pathname.startsWith('/framework')) return
        if (treeInitRef.current) return

        let cancelled = false
        const initTree = async () => {
            treeInitRef.current = true // set synchronously to prevent re-entry (incl. StrictMode double-invoke)
            try {
                /// PRIVATE ///
                const _privateTree = await ResourceTree.create()
                if (cancelled) return // discard the result if the effect was cleaned up meanwhile
                _privateTree.subscribe(triggerRepaint)
                setPrivateTree(_privateTree)

                /// PUBLIC：now didn't have this tree ///
                // const _publicTree = await ResourceTree.create(publicIP!)
                // _publicTree.subscribe(triggerRepaint)
                // setPublicTree(_publicTree)
            } catch (error) {
                treeInitRef.current = false // allow retry on failure
                console.error('Failed to initialize tree:', error)
            }
        }
        initTree()

        return () => { cancelled = true }
    }, [isLoggedIn, location.pathname, publicIP])

    const getCurrentTemplateName = (): string => {
        const selectedNode = privateTree?.selectedNode || publicTree?.selectedNode
        return selectedNode?.template_name || 'default'
    }

    const getResourceNodeByKey = useCallback((key: string): IResourceNode | null => {
        const inPrivate = privateTree?.scene.get(key) ?? null
        if (inPrivate) return inPrivate
        const inPublic = publicTree?.scene.get(key) ?? null
        return inPublic
    }, [privateTree, publicTree])

    const openSettings = useCallback(() => {
        redirectTo('settings')
    }, [redirectTo])

    const renderActiveView = () => {
        const currentTemplateName = getCurrentTemplateName()
        const selectedNode = privateTree?.selectedNode || publicTree?.selectedNode
        switch (activeIconID) {
            case 'map-view':
                return <MapViewComponent templateName={currentTemplateName} selectedNode={selectedNode} getResourceNodeByKey={getResourceNodeByKey} onOpenSettings={openSettings} />
            case 'table-view':
                return <TableViewComponent />
            case 'settings':
                return <SettingView />
            default:
                return <MapViewComponent templateName={currentTemplateName} selectedNode={selectedNode} getResourceNodeByKey={getResourceNodeByKey} onOpenSettings={openSettings} />
        }
    }

    return (
        <div className='w-screen h-screen bg-[#1E1E1E] flex'>
            <IconBar
                currentActiveId={currentActiveId}
                clickHandlers={iconClickHandlers}
                isLoggedIn={isLoggedIn}
            />
            <Routes>
                <Route path='/' element={<Navigate to="/hello" replace />} />
                <Route path='hello' element={<Hello />} />
                <Route
                    path='login'
                    element={
                        isLoggedIn
                            ? <Navigate to="/framework" replace />
                            : <LoginRoute onLogin={() => setIsLoggedIn(true)} />
                    }
                />
                <Route
                    path="framework"
                    element={
                        isLoggedIn
                            ? (
                                activeIconID === 'settings'
                                    ? (
                                        <div className="h-full w-[98%]">
                                            {renderActiveView()}
                                        </div>
                                    )
                                    : (
                                        <ResizablePanelGroup
                                            direction="horizontal"
                                            className="h-full w-[98%] text-white"
                                        >
                                            <ResizablePanel defaultSize={10.5}>
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
                                            <ResizablePanel defaultSize={89.5}>
                                                {renderActiveView()}
                                            </ResizablePanel>
                                        </ResizablePanelGroup>
                                    )
                            )
                            : <Navigate to="/login" replace />
                    }
                />
            </Routes>
        </div>
    )
}


export default function Framework() {
    return (
        <Router>
            <FrameworkShell />
        </Router>
    )
}
