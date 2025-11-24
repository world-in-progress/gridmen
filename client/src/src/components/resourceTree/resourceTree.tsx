import { useState, useEffect, useRef, useCallback, useReducer } from 'react'
import {
    MapPin,
    Square,
    Loader2,
    FilePlus,
    FolderPlus,
    RefreshCcw,
    ChevronDown,
    ChevronRight,
    FolderOpen,
    Folder,
    FileText,
} from 'lucide-react'
import store from '@/store'
import { toast } from 'sonner'
import { cn } from '@/utils/utils'
import { Button } from '../ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from "@/components/ui/separator"
import { ResourceNode, ResourceTree } from '@/template/scene/scene'
import { IResourceNode } from '@/template/scene/iscene'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'


interface NodeRendererProps {
    node: IResourceNode
    resourceTree: ResourceTree
    depth: number
    triggerFocus: number
}

interface TreeRendererProps {
    title: string
    resourceTree: ResourceTree | null
    triggerFocus: number
}

const NodeRenderer = ({ node, resourceTree, depth, triggerFocus }: NodeRendererProps) => {

    const tree = node.tree as ResourceTree

    const isFolder = node.template_name === null
    const isExpanded = tree.isNodeExpanded(node.id)
    const isSelected = tree.selectedNode?.id === node.id

    const nodeRef = useRef<HTMLDivElement>(null)
    const clickTimeoutRef = useRef<NodeJS.Timeout | null>(null)

    const handleClick = useCallback((e: React.MouseEvent) => {
        // Clear any existing timeout to prevent single click when double clicking
        if (clickTimeoutRef.current) {
            clearTimeout(clickTimeoutRef.current)
            clickTimeoutRef.current = null
            return
        }

        // Delay single click execution to allow double click detection
        clickTimeoutRef.current = setTimeout(() => {
            (node.tree as ResourceTree).clickNode(node)
            clickTimeoutRef.current = null
        }, 150)
    }, [node])


    const handleDoubleClick = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()

        // Clear single click timeout
        if (clickTimeoutRef.current) {
            clearTimeout(clickTimeoutRef.current)
            clickTimeoutRef.current = null
        }

        // Prevent text selection
        if (window.getSelection) {
            window.getSelection()?.removeAllRanges()
        }

        (node.tree as ResourceTree).doubleClickNode(node)
    }, [node])

    const handleNodeMenu = useCallback((node: IResourceNode, menuItem: any) => {
        return (node.tree as ResourceTree).getNodeMenuHandler()(node, menuItem)
    }, [])

    // TODO: 渲染node右键菜单
    // const renderNodeMenu = useCallback(() => {
    //     return node.scenarioNode.renderMenu(node, handleNodeMenu)
    // }, [node, handleNodeMenu])

    useEffect(() => {
        if (isSelected && nodeRef.current) {
            nodeRef.current.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            })
        }
    }, [isSelected, triggerFocus])

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (clickTimeoutRef.current) {
                clearTimeout(clickTimeoutRef.current)
            }
        }
    }, [])

    return (
        <div>
            <ContextMenu>
                <ContextMenuTrigger>
                    <div
                        ref={nodeRef}
                        className={cn(
                            'flex items-center py-0.5 px-2 hover:bg-gray-700 cursor-pointer text-sm w-full select-none',
                            isSelected ? 'bg-gray-600 text-white' : 'text-gray-300',
                            !isFolder && 'cursor-grab active:cursor-grabbing',
                            `pl-[${depth * 16 + 2}px]`
                        )}
                        onClick={handleClick}
                        onDoubleClick={handleDoubleClick}
                        draggable={!isFolder} // Only allow dragging files, not folders
                        onDragStart={(e) => {
                            if (!isFolder) {
                                e.dataTransfer.setData('text/plain', node.key);
                                e.dataTransfer.effectAllowed = 'copy';
                            }
                        }}
                    >
                        <div className='ml-2 flex'>
                            {isFolder ? (
                                <>
                                    {isExpanded ? (
                                        <ChevronDown className='w-4 h-4 mr-1' />
                                    ) : (
                                        <ChevronRight className='w-4 h-4 mr-1' />
                                    )}
                                    {isExpanded ? (
                                        <FolderOpen className='w-4 h-4 mr-2 text-blue-400' />
                                    ) : (
                                        <Folder className='w-4 h-4 mr-2 text-blue-400' />
                                    )}
                                </>
                            ) : (
                                (() => {
                                    switch (node.template_name) {
                                        case 'schema':
                                            return <MapPin className='w-4 h-4 mr-2 ml-3 text-gray-400' />
                                        default:
                                            return <FileText className='w-4 h-4 mr-2 ml-3 text-gray-400' />
                                    }
                                })()
                            )}
                        </div>
                        <span>{node.name}</span>
                    </div>
                </ContextMenuTrigger>
                {/* {renderNodeMenu()} */}
            </ContextMenu>

            {/* Render child nodes */}
            {isFolder && isExpanded && node.children && (
                <div>
                    {Array.from(node.children.values()).map(childNode => (
                        <NodeRenderer
                            key={childNode.id}
                            node={childNode}
                            resourceTree={resourceTree}
                            depth={depth + 1}
                            triggerFocus={triggerFocus}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

const TreeRenderer = ({ title, resourceTree, triggerFocus }: TreeRendererProps) => {
    if (!resourceTree) return null

    const handleFilePlusClick = () => {
        console.log('file plus click')
    }

    const handleFolderPlusClick = () => {
        console.log('folder plus click')
    }

    const handleRefreshClick = () => {
        console.log('refresh click')
    }

    return (
        <>
            <div className='z-10 bg-[#2A2C33] py-1 pl-1 text-sm font-semibold flex items-center text-gray-200'>
                <span className='ml-2'>{title}</span>
                <div className='ml-auto mr-2'>
                    {title === 'WorkSpace' && (
                        <>
                            <Button
                                className='w-6 h-6 rounded-sm bg-[#2A2C33] hover:bg-[#363737] text-[#B8B8B8] cursor-pointer'
                                onClick={handleFilePlusClick}
                            >
                                <FilePlus className='w-4 h-4' />
                            </Button>
                            <Button
                                className='w-6 h-6 rounded-sm bg-[#2A2C33] hover:bg-[#363737] text-[#B8B8B8] cursor-pointer'
                                onClick={handleFolderPlusClick}
                            >
                                <FolderPlus className='w-4 h-4' />
                            </Button>
                        </>
                    )}
                    <Button
                        className='w-6 h-6 rounded-sm bg-[#2A2C33] hover:bg-[#363737] text-[#B8B8B8] cursor-pointer'
                        onClick={handleRefreshClick}
                    >
                        <RefreshCcw className='w-4 h-4' />
                    </Button>
                </div>
            </div>
            {resourceTree.root.children && Array.from(resourceTree.root.children.values()).map(childNode => (
                <NodeRenderer
                    key={childNode.id}
                    node={childNode}
                    resourceTree={resourceTree}
                    depth={0}
                    triggerFocus={triggerFocus}
                />
            ))}
        </>
    )
}

interface ResourceTreeComponentProps {
    privateTree: ResourceTree | null
    publicTree: ResourceTree | null
    focusNode: IResourceNode | null
    triggerFocus: number
    onNodeMenuOpen: (node: IResourceNode) => void
    onNodeRemove: (node: IResourceNode) => void
    onNodeClick: (node: IResourceNode) => void
    onNodeDoubleClick: (node: IResourceNode) => void
}

export default function ResourceTreeComponent({
    privateTree,
    publicTree,
    focusNode,
    triggerFocus,
    onNodeMenuOpen,
    onNodeRemove,
    onNodeClick,
    onNodeDoubleClick
}: ResourceTreeComponentProps) {

    const [, triggerRepaint] = useReducer(x => x + 1, 0)

    useEffect(() => {
        if (privateTree) {
            privateTree.bindHandlers({
                onNodeMenuOpen: onNodeMenuOpen,
                onNodeRemove: onNodeRemove,
                onNodeClick: onNodeClick,
                onNodeDoubleClick: onNodeDoubleClick
            })

            const unsubscribe = privateTree.subscribe(triggerRepaint)
            return () => {
                unsubscribe()
            }
        }
    }, [privateTree, onNodeMenuOpen, onNodeRemove, onNodeClick, onNodeDoubleClick])

    useEffect(() => {
        if (publicTree) {
            publicTree.bindHandlers({
                onNodeMenuOpen: onNodeMenuOpen,
                onNodeRemove: onNodeRemove,
                onNodeClick: onNodeClick,
                onNodeDoubleClick: onNodeDoubleClick
            })

            const unsubscribe = publicTree.subscribe(triggerRepaint)
            return () => {
                unsubscribe()
            }
        }
    }, [publicTree, onNodeMenuOpen, onNodeRemove, onNodeClick, onNodeDoubleClick])

    useEffect(() => {
        if (focusNode) {
            const tree = focusNode.tree as ResourceTree
            const expand = async () => {
                const success = await tree.expandNode(focusNode)
                if (success) triggerRepaint()
            }
            expand()
        }
    }, [focusNode, triggerFocus])

    return (
        <div className="flex h-full bg-[#252526] overflow-y-auto">
            <div className="w-full">
                <div className='text-sm font-semibold text-gray-400 py-2 ml-2 tracking-wide'>
                    EXPLORER
                </div>
                {/* WorkSpace */}
                <TreeRenderer resourceTree={privateTree} title={"WorkSpace"} triggerFocus={triggerFocus} />
                <Separator className='my-2 bg-[#585858] w-full' />
                {/* Public */}
                <TreeRenderer resourceTree={publicTree} title={"Public"} triggerFocus={triggerFocus} />
            </div>
        </div>
    )
}
