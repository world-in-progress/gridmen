import React, { useState, useEffect, useCallback, useRef, useReducer } from 'react'
import {
    X,
    Folder,
    FileText,
    FilePlus2,
    FolderPlus,
    CloudCheck,
    FolderOpen,
    ChevronDown,
    ChevronRight,
    CloudDownload,
} from 'lucide-react'
import { cn } from '@/utils/utils'
import { Label } from '../ui/label'
import { Input } from '../ui/input'
import { SceneTree } from './scene'
import { Button } from '../ui/button'
import { useTranslation } from 'react-i18next'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { ISceneNode, ISceneTree } from '@/core/scene/iscene'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogPortal } from '../ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import Store from '@/store'

interface TreeNodeProps {
    node: ISceneNode
    privateTree: ISceneTree
    publicTree: ISceneTree
    depth: number
    triggerFocus: number
}

interface SceneTreeProps {
    triggerFocus: number
    focusNode: ISceneNode | null
    publicTree: SceneTree | null
    privateTree: SceneTree | null
    onOpenFile: (fileName: string, filePath: string) => void
    onPinFile: (fileName: string, filePath: string) => void
    onNodeMenuOpen: (node: ISceneNode, menuItem: any) => void
    onNodeStartEditing: (node: ISceneNode) => void
    onNodeStopEditing: (node: ISceneNode) => void
    onNodeDoubleClick: (node: ISceneNode) => void
    onNodeClick: (node: ISceneNode) => void
    onNodeRemove: (node: ISceneNode) => void
}

interface TreeRendererProps {
    privateTree: SceneTree | null
    publicTree: SceneTree | null
    title: string
    isPublic: boolean
    triggerFocus: number
}

export const NodeRenderer: React.FC<TreeNodeProps> = ({ node, privateTree, publicTree, depth, triggerFocus }) => {
    const tree = node.tree as SceneTree
    const isFolder = node.scenarioNode.degree > 0
    const isExpanded = tree.isNodeExpanded(node.id)
    const isSelected = tree.selectedNode?.id === node.id
    const { t } = useTranslation("resourceScene")
    
    // Check if create resource dialog is open
    const isCreateResourceDialogOpen = Store.get<boolean>('isCreateResourceDialogOpen') || false

    const nodeRef = useRef<HTMLDivElement>(null)
    const [isDownloaded, setIsDownloaded] = useState(false)
    const clickTimeoutRef = useRef<NodeJS.Timeout | null>(null)

    const handleClick = useCallback((e: React.MouseEvent) => {
        // Disable click when create resource dialog is open
        if (isCreateResourceDialogOpen) return
        
        // Clear any existing timeout to prevent single click when double clicking
        if (clickTimeoutRef.current) {
            clearTimeout(clickTimeoutRef.current)
            clickTimeoutRef.current = null
            return
        }

        // Delay single click execution to allow double click detection
        clickTimeoutRef.current = setTimeout(() => {
            (node.tree as SceneTree).clickNode(node)
            clickTimeoutRef.current = null
        }, 150)
    }, [node, isCreateResourceDialogOpen])

    const handleDoubleClick = useCallback((e: React.MouseEvent) => {
        // Disable double click when create resource dialog is open
        if (isCreateResourceDialogOpen) return
        
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

        (node.tree as SceneTree).doubleClickNode(node)
    }, [node, isCreateResourceDialogOpen])

    const handleNodeMenu = useCallback((node: ISceneNode, menuItem: any) => {
        return (node.tree as SceneTree).getNodeMenuHandler()(node, menuItem)
    }, [])

    const renderNodeMenu = useCallback(() => {
        return node.scenarioNode.renderMenu(node, handleNodeMenu)
    }, [node, handleNodeMenu])

    const handleClickPublicDownload = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault()
        setIsDownloaded(true)
    }

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
                <ContextMenuTrigger disabled={isCreateResourceDialogOpen}>
                    <div
                        ref={nodeRef}
                        className={cn(
                            'flex items-center py-0.5 px-2 text-sm w-full select-none',
                            isSelected ? 'bg-gray-600 text-white' : 'text-gray-300',
                            // Dynamic cursor and hover styles based on dialog state
                            isCreateResourceDialogOpen 
                                ? (isFolder 
                                    ? 'cursor-grab active:cursor-grabbing hover:bg-gray-700' 
                                    : 'cursor-not-allowed opacity-50') 
                                : 'cursor-grab active:cursor-grabbing hover:bg-gray-700'
                        )}
                        style={{ paddingLeft: `${depth * 16 + 2}px` }}
                        onClick={handleClick}
                        onDoubleClick={handleDoubleClick}
                        draggable={isCreateResourceDialogOpen ? isFolder : true} // When dialog is open, only allow folder dragging
                        onDragStart={(e) => {
                            // When dialog is open, only allow folder dragging
                            if (isCreateResourceDialogOpen && !isFolder) {
                                e.preventDefault()
                                return
                            }
                            
                            e.dataTransfer.setData('text/plain', node.key)
                            e.dataTransfer.setData('application/node-id', node.id)
                            e.dataTransfer.setData('application/node-type', isFolder ? 'folder' : 'file')
                            e.dataTransfer.effectAllowed = 'copy'
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
                                <FileText className='w-4 h-4 mr-2 ml-3 text-gray-400' />
                            )}
                        </div>
                        <span>{node.name}</span>
                        {!isFolder && tree.isPublic &&
                            <button
                                type='button'
                                className={`flex rounded-md w-6 h-6 ${!isDownloaded && 'hover:bg-gray-500'} items-center justify-center mr-1 ml-auto cursor-pointer`}
                                title={t('download')}
                                onClick={handleClickPublicDownload}
                            >
                                {isDownloaded ? <CloudCheck className='w-4 h-4 text-green-500' /> : <CloudDownload className='w-4 h-4 text-white' />}
                            </button>}
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
                            privateTree={privateTree}
                            publicTree={publicTree}
                            depth={depth + 1}
                            triggerFocus={triggerFocus}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

const CustomDialogContent = React.forwardRef<
    React.ElementRef<typeof DialogPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
        showCloseButton?: boolean
    }
>(({ className, children, showCloseButton = true, ...props }, ref) => (
    <DialogPortal>
        <DialogPrimitive.Content
            ref={ref}
            className={cn(
                "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg",
                className
            )}
            {...props}
        >
            {children}
            {showCloseButton && (
                <DialogPrimitive.Close className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4">
                    <X className="h-4 w-4" />
                    <span className="sr-only">Close</span>
                </DialogPrimitive.Close>
            )}
        </DialogPrimitive.Content>
    </DialogPortal>
))
CustomDialogContent.displayName = "CustomDialogContent"

const TreeRenderer: React.FC<TreeRendererProps> = ({ privateTree, publicTree, title, isPublic, triggerFocus }) => {
    if (!privateTree && !publicTree) return null
    const tree = isPublic ? publicTree : privateTree
    const { t } = useTranslation("resourceScene")
    const [isAnyDialogOpen, setIsAnyDialogOpen] = useState(false)
    
    // State for Create Resource Node dialog
    const [resourceName, setResourceName] = useState('')
    const [resourceType, setResourceType] = useState('')
    const [targetFolder, setTargetFolder] = useState<string | null>(null)
    const [dragOver, setDragOver] = useState(false)

    // Reset form when dialog closes
    const resetForm = () => {
        setResourceName('')
        setResourceType('')
        setTargetFolder(null)
        setDragOver(false)
    }

    // Handle drag events for drop zone
    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        setDragOver(true)
    }

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault()
        setDragOver(false)
    }

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        setDragOver(false)
        
        const nodeType = e.dataTransfer.getData('application/node-type')
        const nodeId = e.dataTransfer.getData('application/node-id')
        
        if (nodeType === 'folder' && nodeId) {
            // Find the node by ID to get its name
            const findNodeById = (node: ISceneNode, targetId: string): ISceneNode | null => {
                if (node.id === targetId) return node
                if (node.children) {
                    for (const child of node.children.values()) {
                        const found = findNodeById(child, targetId)
                        if (found) return found
                    }
                }
                return null
            }
            
            const foundNode = findNodeById(tree!.root, nodeId)
            if (foundNode) {
                setTargetFolder(foundNode.name)
            }
        }
    }

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        // TODO: Implement resource creation logic
        console.log('Creating resource:', { resourceName, resourceType, targetFolder })
        resetForm()
    }

    return (
        <>
            <div className='flex items-center z-10 bg-[#2A2C33] py-1 pl-1 text-sm font-semibold text-gray-200'>
                <span className='ml-2'>{t(title)}</span>
                {tree === privateTree && (
                    <div className='flex items-center gap-0.5 ml-auto mr-2'>
                        <Dialog modal={false} onOpenChange={(open) => {
                            setIsAnyDialogOpen(open)
                            Store.set('isCreateResourceDialogOpen', open)
                            if (!open) resetForm()
                        }}>
                            <form onSubmit={handleSubmit}>
                                <DialogTrigger asChild>
                                    <Button
                                        variant='ghost'
                                        className={`w-5 h-5 ${isAnyDialogOpen ? 'cursor-not-allowed opacity-50' : 'hover:bg-[#363737] cursor-pointer'}`}
                                        disabled={isAnyDialogOpen}
                                    >
                                        <FilePlus2 className='w-4 h-4 text-white' />
                                    </Button>
                                </DialogTrigger>
                                <CustomDialogContent
                                    className="sm:max-w-[400px]"
                                    onInteractOutside={(e) => { e.preventDefault() }}
                                >
                                    <DialogHeader>
                                        <DialogTitle>Create Resource Node</DialogTitle>
                                        <DialogDescription>
                                            Create a new resource node with the specified name and type.
                                        </DialogDescription>
                                    </DialogHeader>
                                    <div className="grid gap-4">
                                        <div className="grid gap-3">
                                            <Label htmlFor="resource-name">Name</Label>
                                            <Input 
                                                id="resource-name" 
                                                name="name" 
                                                value={resourceName}
                                                onChange={(e) => setResourceName(e.target.value)}
                                                placeholder="Enter resource name"
                                                required
                                            />
                                        </div>
                                        <div className="grid gap-3">
                                            <Label htmlFor="resource-type">Type</Label>
                                            <Select value={resourceType} onValueChange={setResourceType} required>
                                                <SelectTrigger id="resource-type" className='w-full cursor-pointer'>
                                                    <SelectValue placeholder="Select resource type" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="schema">Schema</SelectItem>
                                                    <SelectItem value="patch">Patch</SelectItem>
                                                    <SelectItem value="grid">Grid</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="grid gap-3">
                                            <Label>Target Folder</Label>
                                            <div
                                                className={`border-2 h-16 border-dashed rounded-lg p-4 flex items-center justify-center transition-colors ${
                                                    dragOver 
                                                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950' 
                                                        : 'border-gray-300 dark:border-gray-600'
                                                }`}
                                                onDragOver={handleDragOver}
                                                onDragLeave={handleDragLeave}
                                                onDrop={handleDrop}
                                            >
                                                {targetFolder ? (
                                                    <div className="flex items-center justify-center gap-2 border-2 border-gray-300 rounded-lg p-2">
                                                        <Folder className="w-4 h-4 text-blue-500" />
                                                        <span className="text-sm font-medium">{targetFolder}</span>
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => setTargetFolder(null)}
                                                            className="h-6 w-6 p-0 cursor-pointer"
                                                        >
                                                            <X className="w-3 h-3" />
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <div className="text-sm text-muted-foreground">
                                                        Drag a folder here to set as target location
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <DialogFooter>
                                        <DialogClose asChild>
                                            <Button variant="outline" className='cursor-pointer'>Cancel</Button>
                                        </DialogClose>
                                        <Button 
                                            type="submit" 
                                            className='cursor-pointer'
                                            disabled={!resourceName || !resourceType}
                                        >
                                            Create Resource
                                        </Button>
                                    </DialogFooter>
                                </CustomDialogContent>
                            </form>
                        </Dialog>
                        <Dialog modal={false} onOpenChange={(open) => {
                            setIsAnyDialogOpen(open)
                            Store.set('isCreateResourceDialogOpen', open)
                        }}>
                            <form>
                                <DialogTrigger asChild>
                                    <Button
                                        variant='ghost'
                                        className={`w-5 h-5 ${isAnyDialogOpen ? 'cursor-not-allowed opacity-50' : 'hover:bg-[#363737] cursor-pointer'}`}
                                        disabled={isAnyDialogOpen}
                                    >
                                        <FolderPlus className='w-4 h-4 text-white' />
                                    </Button>
                                </DialogTrigger>
                                <CustomDialogContent
                                    className="sm:max-w-[425px]"
                                    onInteractOutside={(e) => { e.preventDefault() }}
                                >
                                    <DialogHeader>
                                        <DialogTitle>Edit profile</DialogTitle>
                                        <DialogDescription>
                                            Make changes to your profile here. Click save when you&apos;re
                                            done.
                                        </DialogDescription>
                                    </DialogHeader>
                                    <div className="grid gap-4">
                                        <div className="grid gap-3">
                                            <Label htmlFor="name-1">Name</Label>
                                            <Input id="name-1" name="name" defaultValue="Pedro Duarte" />
                                        </div>
                                        <div className="grid gap-3">
                                            <Label htmlFor="username-1">Username</Label>
                                            <Input id="username-1" name="username" defaultValue="@peduarte" />
                                        </div>
                                    </div>
                                    <DialogFooter>
                                        <DialogClose asChild>
                                            <Button variant="outline" className='cursor-pointer'>Cancel</Button>
                                        </DialogClose>
                                        <Button type="submit" className='cursor-pointer'>Save changes</Button>
                                    </DialogFooter>
                                </CustomDialogContent>
                            </form>
                        </Dialog>
                    </div>
                )}
            </div>
            <NodeRenderer key={tree!.root.id} node={tree!.root} privateTree={privateTree!} publicTree={publicTree!} depth={0} triggerFocus={triggerFocus} />
        </>
    )
}

export default function ResourceTreeComponent({
    focusNode,
    triggerFocus,
    privateTree,
    publicTree,
    onOpenFile,
    onPinFile,
    onNodeMenuOpen,
    onNodeStartEditing,
    onNodeStopEditing,
    onNodeDoubleClick,
    onNodeClick,
    onNodeRemove,
}: SceneTreeProps) {

    const { t } = useTranslation("resourceScene")

    // Force focusing on the focused node 
    // to ensure focus again when the component re-renders
    const [, triggerRepaint] = useReducer(x => x + 1, 0)

    // Bind handlers to private tree
    useEffect(() => {
        if (privateTree) {
            privateTree.bindHandlers({
                openFile: onOpenFile,
                pinFile: onPinFile,
                handleNodeMenuOpen: onNodeMenuOpen,
                handleNodeStartEditing: onNodeStartEditing,
                handleNodeStopEditing: onNodeStopEditing,
                handleNodeDoubleClick: onNodeDoubleClick,
                handleNodeClick: onNodeClick,
                handleNodeRemove: onNodeRemove,
            })

            const unsubscribe = privateTree.subscribe(triggerRepaint)
            return () => {
                unsubscribe()
            }
        }
    }, [privateTree, onOpenFile, onPinFile, onNodeMenuOpen, onNodeStartEditing, onNodeStopEditing, onNodeDoubleClick, onNodeClick, onNodeRemove])

    // Bind handlers to public tree
    useEffect(() => {
        if (publicTree) {
            publicTree.bindHandlers({
                openFile: onOpenFile,
                pinFile: onPinFile,
                handleNodeMenuOpen: onNodeMenuOpen,
                handleNodeStartEditing: onNodeStartEditing,
                handleNodeStopEditing: onNodeStopEditing,
                handleNodeDoubleClick: onNodeDoubleClick,
                handleNodeClick: onNodeClick,
                handleNodeRemove: onNodeRemove,
            })

            const unsubscribe = publicTree.subscribe(triggerRepaint)
            return () => {
                unsubscribe()
            }
        }
    }, [publicTree, onOpenFile, onPinFile, onNodeMenuOpen, onNodeStartEditing, onNodeStopEditing, onNodeDoubleClick, onNodeClick, onNodeRemove])

    useEffect(() => {
        if (focusNode) {
            const tree = focusNode.tree as SceneTree
            const expand = async () => {
                const success = await tree.expandNode(focusNode)
                if (success) triggerRepaint()
            }
            expand()
        }
    }, [focusNode, triggerFocus])

    return (
        <ScrollArea className='h-full bg-[#252526] overflow-hidden'>
            <div className='w-full bg-[#252526]'>
                <div className='text-sm font-semibold text-gray-400 py-2 ml-2 uppercase tracking-wide'>
                    {t('EXPLORER')}
                </div>
                {privateTree && (
                    <TreeRenderer privateTree={privateTree} publicTree={publicTree} title='Private' isPublic={false} triggerFocus={triggerFocus} />
                )}
                <Separator className='my-2 bg-[#585858] w-full' />
                {publicTree && (
                    <TreeRenderer privateTree={privateTree} publicTree={publicTree} title='Public' isPublic={true} triggerFocus={triggerFocus} />
                )}
            </div>
        </ScrollArea>
    )
}