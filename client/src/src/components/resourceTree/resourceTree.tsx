import { useState, useEffect, useRef, useCallback, useReducer } from 'react'
import {
    File,
    Plus,
    Check,
    Folder,
    MapPin,
    Square,
    FilePlus,
    FolderOpen,
    FolderPlus,
    RefreshCcw,
    ChevronDown,
    ChevronRight,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/utils/utils'
import { Button } from '../ui/button'
import * as api from '@/template/noodle/apis'
import { Input } from '@/components/ui/input'
import { Separator } from "@/components/ui/separator"
import { ResourceTree } from '@/template/scene/scene'
import { IResourceNode } from '@/template/scene/iscene'
import { useSelectedNodeStore } from '@/store/storeSet'
import { RESOURCE_REGISTRY } from '@/registry/resourceRegistry'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"

interface NodeRendererProps {
    node: IResourceNode
    resourceTree: ResourceTree
    depth: number
    triggerFocus: number
    dragSourceTreeTitle?: string
}

interface TreeRendererProps {
    title: string
    resourceTree: ResourceTree | null
    triggerFocus: number
}

const NodeRenderer = ({ node, resourceTree, depth, triggerFocus, dragSourceTreeTitle: sourceTreeTitle }: NodeRendererProps) => {

    const tree = node.tree as ResourceTree

    const isFolder = node.template_name === 'default'
    const isExpanded = tree.isNodeExpanded(node.id)
    const isSelected = tree.selectedNode?.id === node.id

    const { setSelectedNodeKey } = useSelectedNodeStore()

    const nodeRef = useRef<HTMLDivElement>(null)
    const clickTimeoutRef = useRef<NodeJS.Timeout | null>(null)
    const [isDragOver, setIsDragOver] = useState(false)

    const handleClickNode = useCallback((e: React.MouseEvent) => {
        console.log(node.template_name)
        // Clear any existing timeout to prevent single click when double clicking
        if (clickTimeoutRef.current) {
            clearTimeout(clickTimeoutRef.current)
            clickTimeoutRef.current = null
            return
        }

        if (isFolder) {
            setSelectedNodeKey(node.key)
            clickTimeoutRef.current = setTimeout(() => {
                (node.tree as ResourceTree).clickNode(node)
                clickTimeoutRef.current = null
            }, 150)
        } else {
            // 清除高亮，仅右键菜单作为入口
            setSelectedNodeKey(null)
        }
    }, [node, isFolder, setSelectedNodeKey])


    const handleDoubleClickNode = useCallback((e: React.MouseEvent) => {
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

    const renderNodeMenu = useCallback(() => {
        return node.template!.renderMenu(node, handleNodeMenu)
    }, [node, handleNodeMenu])

    const handleDragStart = useCallback((e: React.DragEvent) => {
        if (!isFolder) {
            e.dataTransfer.setData('text/plain', JSON.stringify({
                nodeKey: node.key,
                templateName: node.template_name,
                sourceTreeTitle: sourceTreeTitle || ''
            }))
            e.dataTransfer.effectAllowed = 'copy'
        }
    }, [node, isFolder, sourceTreeTitle])

    const handleDragOver = useCallback((e: React.DragEvent) => {
        if (isFolder) {
            e.preventDefault()
            e.stopPropagation()
            e.dataTransfer.dropEffect = 'copy'
            setIsDragOver(true)
        } else {
            // 如果不是文件夹，允许事件继续冒泡到根目录
            // 不阻止传播，让根目录可以接收拖放
        }
    }, [isFolder])

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        if (!isFolder) return

        const rect = e.currentTarget.getBoundingClientRect()
        const x = e.clientX
        const y = e.clientY

        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
            setIsDragOver(false)
        }
    }, [isFolder])

    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragOver(false)

        if (!isFolder || !resourceTree) return

        try {
            const data = e.dataTransfer.getData('text/plain')
            if (!data) return

            const dragData = JSON.parse(data)
            const { nodeKey: sourceNodeKey, templateName, sourceTreeTitle: sourceTitle } = dragData
            const targetTitle = sourceTreeTitle || ''

            // 如果源节点是文件夹，不允许拖放
            if (templateName === 'default') {
                toast.error('Cannot drag folders')
                return
            }

            // 构建目标节点 key
            const targetNodeKey = node.key === '.'
                ? `.${sourceNodeKey.split('.').pop()}`
                : `${node.key}.${sourceNodeKey.split('.').pop()}`

            // 同一棵树内部
            if (sourceTitle === targetTitle) {
                if (targetTitle === 'Public') {
                    // Public 内部禁止
                    return
                } else if (targetTitle === 'WorkSpace') {
                    // Private 内部：预留逻辑占位
                    console.debug('TODO: handle private-to-private move', sourceNodeKey, targetNodeKey)
                    return
                }
            }

            // private -> public
            if (sourceTitle === 'WorkSpace' && targetTitle === 'Public') {
                const publicTargetNodeKey = 'http://127.0.0.1:8000::' + targetNodeKey

                console.log('push行为', {
                    template_name: templateName,
                    source_node_key: sourceNodeKey,
                    target_node_key: publicTargetNodeKey
                })

                await api.node.pushNode({
                    template_name: templateName,
                    source_node_key: sourceNodeKey,
                    target_node_key: publicTargetNodeKey
                })

                await resourceTree.refresh()
                toast.success(`Pushed node to ${node.name}`)

                return
            }

            // public -> private
            if (sourceTitle === 'Public' && targetTitle === 'WorkSpace') {

                const privateSourceNodeKey = 'http://127.0.0.1:8000::' + sourceNodeKey

                console.log('pull行为', {
                    template_name: templateName,
                    source_node_key: privateSourceNodeKey,
                    target_node_key: targetNodeKey
                })

                await api.node.pullNode({
                    template_name: templateName,
                    source_node_key: privateSourceNodeKey,
                    target_node_key: targetNodeKey,
                })

                await resourceTree.refresh()
                toast.success(`Pulled node to ${node.name}`)

                return
            }

            await resourceTree.refresh()
            toast.success(`Node added to ${node.name}`)
        } catch (error) {
            console.error('Drop error:', error)
            toast.error('Failed to add node')
        }
    }, [isFolder, resourceTree, node.key, node.name, sourceTreeTitle])

    useEffect(() => {
        if (isSelected && nodeRef.current) {
            nodeRef.current.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            })
        }
    }, [isSelected, triggerFocus])

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
                            isFolder && isDragOver && 'bg-gray-500/50',
                        )}
                        data-node-type={isFolder ? 'folder' : 'file'}
                        style={{ paddingLeft: `${depth * 10}px` }}
                        onClick={handleClickNode}
                        onDoubleClick={handleDoubleClickNode}
                        draggable={!isFolder}
                        onDragStart={(e) => { handleDragStart(e) }}
                        onDragOver={(e) => { handleDragOver(e) }}
                        onDragLeave={(e) => { handleDragLeave(e) }}
                        onDrop={(e) => { handleDrop(e) }}
                    >
                        <div className='ml-1.5 flex'>
                            {isFolder ? (
                                <>
                                    {isExpanded ? (
                                        <>
                                            <ChevronDown className='w-4 h-4 mr-0.5' />
                                            <FolderOpen className='w-4 h-4 mr-2 text-gray-400' />
                                        </>
                                    ) : (
                                        <>
                                            <ChevronRight className='w-4 h-4 mr-0.5' />
                                            <Folder className='w-4 h-4 mr-2 text-gray-400' />
                                        </>
                                    )}
                                </>
                            ) : (
                                (() => {
                                    switch (node.template_name) {
                                        case 'schema':
                                            return <MapPin className='w-4 h-4 mr-2 ml-4.5 text-red-500' />
                                        case 'patch':
                                            return <Square className='w-4 h-4 mr-2 ml-4.5 text-sky-500' />
                                        default:
                                            return <File className='w-4 h-4 mr-2 ml-4.5 text-blue-500' />
                                    }
                                })()
                            )}
                        </div>
                        <span>{node.name}</span>
                    </div>
                </ContextMenuTrigger>
                {renderNodeMenu()}
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
                            dragSourceTreeTitle={sourceTreeTitle}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

const TreeRenderer = ({ title, resourceTree, triggerFocus }: TreeRendererProps) => {
    let newNodeKey

    const [open, setOpen] = useState(false)
    const [value, setValue] = useState("")
    const [newResourceName, setNewResourceName] = useState<string>('')
    const [newFolderName, setNewFolderName] = useState<string>('')
    const [showNewResourceInfo, setShowNewResourceInfo] = useState<boolean>(false)
    const [showNewFolderInput, setShowNewFolderInput] = useState<boolean>(false)
    const newResourceInputRef = useRef<HTMLInputElement>(null)
    const newResourceDivRef = useRef<HTMLDivElement>(null)
    const newFolderInputRef = useRef<HTMLInputElement>(null)
    const { selectedNodeKey, setSelectedNodeKey } = useSelectedNodeStore()

    const handleClickTreeTitle = () => {
        if (resourceTree) {
            resourceTree.selectedNode = null
        }
        setSelectedNodeKey('.')
    }

    const handleFilePlusClick = (e: React.MouseEvent) => {
        if (resourceTree && resourceTree.tempNodeExist === true) {
            toast.error('Please delete the previously created temporary node or complete the formal creation of the node.')
            return
        }
        e.stopPropagation()
        e.preventDefault()
        setShowNewResourceInfo(true)
        setNewResourceName('')
        handleCancelNewFolder()
    }

    const handleFolderPlusClick = (e: React.MouseEvent) => {
        e.stopPropagation()
        e.preventDefault()
        setShowNewFolderInput(true)
        setNewFolderName('')
        handleCancelNewResource()
    }

    const handleCreateNewResource = async () => {
        const tempNodeName = ''
        // ' (not confirm yet)'

        if (newResourceName.trim() === '') {
            toast.error('Resource name cannot be empty')
            return
        }
        if (resourceTree) {
            try {
                if (selectedNodeKey !== null) {
                    newNodeKey = selectedNodeKey + '.' + newResourceName + tempNodeName
                } else {
                    newNodeKey = '.' + newResourceName + tempNodeName
                }

                await api.node.mountNode({
                    node_key: newNodeKey,
                    template_name: value,
                    mount_params_string: JSON.stringify({})
                })

                // 标记新建的临时节点，便于后续 creation 激活
                setSelectedNodeKey(newNodeKey)

                setNewResourceName('')
                setShowNewResourceInfo(false)

                await resourceTree.refresh()

                const createdNode = resourceTree.scene.get(newNodeKey)
                if (createdNode) {
                    await resourceTree.clickNode(createdNode)
                }

                resourceTree.tempNodeExist = true
            } catch {
                toast.error('Failed to create new resource')
            }
        }
    }

    const handleCreateNewFolder = async () => {
        if (newFolderName.trim() === '') {
            toast.error('Folder name cannot be empty')
            return
        }
        if (resourceTree) {
            try {
                if (selectedNodeKey !== null) {
                    newNodeKey = selectedNodeKey + '.' + newFolderName
                } else {
                    newNodeKey = '.' + newFolderName
                }

                await api.node.mountNode({
                    node_key: newNodeKey,
                    template_name: '',
                    mount_params_string: ''
                })

                setNewFolderName('')
                setShowNewFolderInput(false)

                await resourceTree.refresh()
            }
            catch {
                toast.error('Failed to create new folder')
            }
        }
    }

    const handleCancelNewResource = () => {
        setNewResourceName('')
        setShowNewResourceInfo(false)
        setValue('')
        setOpen(false)
    }

    const checkFocus = (e: React.FocusEvent<HTMLDivElement>) => {
        const relatedTarget = e.relatedTarget as HTMLElement | null
        const isPopoverContent = relatedTarget?.closest('[data-slot="popover-content"]')

        if (open || isPopoverContent) {
            return
        }

        if (!newResourceDivRef.current?.contains(relatedTarget as Node)) {
            setTimeout(() => {
                if (showNewResourceInfo && !open) {
                    handleCancelNewResource()
                }
            })
        }
    }

    const handlePopoverOpenChange = (isOpen: boolean) => {
        setOpen(isOpen)
        if (!isOpen && showNewResourceInfo && newResourceInputRef.current) {
            setTimeout(() => {
                newResourceInputRef.current?.focus()
            }, 0)
        }
    }

    const handleResourceTypeSelect = () => {
        const selectedResource = RESOURCE_REGISTRY.find((resource) => resource.value === value)

        if (!selectedResource) {
            return <File className="w-4 h-4" />
        }

        const SelectedIcon = selectedResource.icon

        return <SelectedIcon className="w-4 h-4" />
    }

    const handleNewResourceKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            if (value === '') {
                toast.info('Please select new resource type.')
                return
            } else {
                handleCreateNewResource()
            }
        } else if (e.key === 'Escape') {
            handleCancelNewResource()
        }
    }

    const handleCancelNewFolder = () => {
        setNewFolderName('')
        setShowNewFolderInput(false)
    }

    const handleNewFolderKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            handleCreateNewFolder()
        } else if (e.key === 'Escape') {
            handleCancelNewFolder()
        }
    }

    const handleRefreshClick = async (e: React.MouseEvent) => {
        e.stopPropagation()
        if (resourceTree) {
            await resourceTree.refresh()
        }
    }

    useEffect(() => {
        if (showNewFolderInput && newFolderInputRef.current) {
            newFolderInputRef.current.focus()
        }
    }, [showNewFolderInput])


    const handleRootDragOver = (e: React.DragEvent) => {
        // 允许在根目录放置，但不显示高亮
        // 检查是否拖拽到了子节点（文件夹），如果是则不处理，让子节点处理
        const target = e.target as HTMLElement
        const isDraggingOverChild = target.closest('[data-node-type="folder"]')

        if (!isDraggingOverChild) {
            e.preventDefault()
            e.stopPropagation()
            e.dataTransfer.dropEffect = 'copy'
        }
    }

    const handleRootDrop = async (e: React.DragEvent) => {
        // 如果拖放到了子节点（文件夹），让子节点处理
        const target = e.target as HTMLElement
        const isDroppingOnChild = target.closest('[data-node-type="folder"]')
        if (isDroppingOnChild) {
            return
        }

        e.preventDefault()
        e.stopPropagation()

        if (!resourceTree) return

        try {
            const data = e.dataTransfer.getData('text/plain')
            if (!data) return

            const dragData = JSON.parse(data)
            const { nodeKey: sourceNodeKey, templateName, sourceTreeTitle: sourceTitle } = dragData

            // 如果源节点是文件夹，不允许拖放
            if (templateName === 'default') {
                toast.error('Cannot drag folders')
                return
            }

            // 构建目标节点 key（添加到根目录）
            const targetNodeKey = `.${sourceNodeKey.split('.').pop()}`

            // 同一棵树内部
            if (sourceTitle === title) {
                if (title === 'Public') {
                    // Public 内部禁止
                    return
                } else if (title === 'WorkSpace') {
                    // Private 内部：预留逻辑占位
                    console.debug('TODO: handle private-to-private move at root', sourceNodeKey, targetNodeKey)
                    return
                }
            }

            // private -> public
            if (sourceTitle === 'WorkSpace' && title === 'Public') {
                await api.node.pushNode({
                    template_name: templateName,
                    source_node_key: sourceNodeKey,
                    target_node_key: targetNodeKey
                })
                await resourceTree.refresh()
                toast.success(`Pushed node to ${title}`)
                return
            }

            // public -> private
            if (sourceTitle === 'Public' && title === 'WorkSpace') {
                await api.node.pullNode({
                    template_name: templateName,
                    source_node_key: sourceNodeKey,
                    target_node_key: targetNodeKey
                })
                await resourceTree.refresh()
                toast.success(`Pulled node to ${title}`)
                return
            }

            await resourceTree.refresh()
            toast.success(`Node added to ${title}`)
        } catch (error) {
            console.error('Drop error:', error)
            toast.error('Failed to add node')
        }
    }

    return (
        <div
            onDragOver={handleRootDragOver}
            onDrop={handleRootDrop}
        >
            <div
                className='z-10 bg-[#2A2C33] py-1 pl-1 text-sm font-semibold flex items-center text-gray-200 cursor-pointer'
                onClick={handleClickTreeTitle}
            >
                <span className='ml-2'>{title}</span>
                <div className='ml-auto mr-2'>
                    {title === 'WorkSpace' && (
                        <>
                            <Button
                                className='w-6 h-6 rounded-sm bg-[#2A2C33] hover:bg-[#363737] text-[#B8B8B8] cursor-pointer'
                                onClick={(e) => handleFilePlusClick(e)}
                            >
                                <FilePlus className='w-4 h-4' />
                            </Button>
                            <Button
                                className='w-6 h-6 rounded-sm bg-[#2A2C33] hover:bg-[#363737] text-[#B8B8B8] cursor-pointer'
                                onClick={(e) => handleFolderPlusClick(e)}
                            >
                                <FolderPlus className='w-4 h-4' />
                            </Button>
                        </>
                    )}
                    <Button
                        className='w-6 h-6 rounded-sm bg-[#2A2C33] hover:bg-[#363737] text-[#B8B8B8] cursor-pointer'
                        onClick={(e) => handleRefreshClick(e)}
                    >
                        <RefreshCcw className='w-4 h-4' />
                    </Button>
                </div>
            </div>
            {resourceTree && resourceTree.root.children && Array.from(resourceTree.root.children.values()).map(childNode => (
                <NodeRenderer
                    key={childNode.id}
                    node={childNode}
                    resourceTree={resourceTree}
                    depth={0}
                    triggerFocus={triggerFocus}
                    dragSourceTreeTitle={title}
                />
            ))}
            {showNewFolderInput && (
                <div className={cn('flex items-center py-0.5 px-2 text-sm w-full select-none')}>
                    <div className='flex'>
                        <Plus className='w-4 h-4 mr-0.5' />
                        <Folder className='w-4 h-4 mr-2 text-gray-400' />
                    </div>
                    <Input
                        ref={newFolderInputRef}
                        value={newFolderName}
                        onChange={e => setNewFolderName(e.target.value)}
                        onKeyDown={handleNewFolderKeyDown}
                        onBlur={handleCancelNewFolder}
                        className="h-6 text-sm rounded-xs bg-[#3C3C3C] border-gray-600"
                        autoFocus
                    />
                </div>
            )}
            {showNewResourceInfo && (
                <div
                    ref={newResourceDivRef}
                    className={cn(
                        'flex items-center py-0.5 px-1 gap-0.5 text-sm w-full select-none',
                        `pl-[${0 * 16 + 2}px]`
                    )}
                >
                    <Popover
                        open={open}
                        onOpenChange={(isOpen) => handlePopoverOpenChange(isOpen)}
                    >
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                role="combobox"
                                aria-expanded={open}
                                onMouseDown={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                }}
                                className="h-6 w-6 text-black rounded-xs flex items-center justify-center cursor-pointer"
                            >
                                {handleResourceTypeSelect()}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-36 p-0">
                            <Command>
                                <CommandInput placeholder="Search" className="h-6" />
                                <CommandList>
                                    <CommandEmpty>No Resource found</CommandEmpty>
                                    <CommandGroup>
                                        {RESOURCE_REGISTRY.map((resource) => {
                                            const ResourceIcon = resource.icon
                                            return (
                                                <CommandItem
                                                    key={resource.value}
                                                    value={resource.value}
                                                    onSelect={(currentValue) => {
                                                        setValue(currentValue === value ? "" : currentValue)
                                                        setOpen(false)
                                                    }}
                                                    className='cursor-pointer'
                                                >
                                                    <ResourceIcon className="h-4 w-4" />
                                                    {resource.label}
                                                    <Check
                                                        className={cn(
                                                            "ml-auto",
                                                            value === resource.value ? "opacity-100" : "opacity-0"
                                                        )}
                                                    />
                                                </CommandItem>
                                            )
                                        })}
                                    </CommandGroup>
                                </CommandList>
                            </Command>
                        </PopoverContent>
                    </Popover>
                    <Input
                        ref={newResourceInputRef}
                        value={newResourceName}
                        onChange={e => setNewResourceName(e.target.value)}
                        onKeyDown={handleNewResourceKeyDown}
                        onBlur={e => checkFocus(e)}
                        className="h-6 text-sm rounded-xs bg-[#3C3C3C] border-gray-600"
                        autoFocus
                    />
                </div>
            )}
        </div>
    )
}

interface ResourceTreeComponentProps {
    privateTree: ResourceTree | null
    publicTree: ResourceTree | null
    focusNode: IResourceNode | null
    triggerFocus: number
    onNodeMenuOpen: (node: IResourceNode, menuItem: any) => void
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
