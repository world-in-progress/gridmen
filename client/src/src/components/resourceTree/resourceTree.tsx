import { useState, useEffect, useRef, useCallback, useReducer } from 'react'
import {
    MapPin,
    Square,
    Loader2,
    FilePlus,
    FolderPlus,
    RefreshCcw,
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

const NodeRenderer = ({ node }: NodeRendererProps) => {

    const tree = node.tree as ResourceTree

    //     const isSelected = 


    return (
        <div>
            <ContextMenu>
                <ContextMenuTrigger>
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

interface NodeData {
    id: string
    label: string
    icon: 'MapPin' | 'Square'
    sourceTitle: string
    status: 'ready' | 'pending'
}

const TreeRenderer = ({ title, resourceTree, triggerFocus }: TreeRendererProps) => {
    if (!resourceTree) return null

    return (
        <>
            <div className='z-10 bg-[#2A2C33] py-1 pl-1 text-sm font-semibold flex items-center text-gray-200'>
                <span className='ml-2'>{title}</span>
            </div>
            <NodeRenderer key={resourceTree.root.id} node={resourceTree.root} resourceTree={resourceTree} depth={0} triggerFocus={triggerFocus} />
        </>
    )


    // const depth = 0

    // const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
    // const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
    // const [editingIcon, setEditingIcon] = useState<'MapPin' | 'Square'>('MapPin')
    // const [editingLabel, setEditingLabel] = useState('')
    // const [nodes, setNodes] = useState<NodeData[]>(() => {

    //     if (title === 'WorkSpace') {
    //         return [
    //             { id: 'ws-1', label: '111', icon: 'MapPin', sourceTitle: 'WorkSpace', status: 'ready' },
    //             { id: 'ws-2', label: '222', icon: 'MapPin', sourceTitle: 'WorkSpace', status: 'ready' }
    //         ]
    //     } else {
    //         return [
    //             { id: 'pub-1', label: 'schema lead', icon: 'MapPin', sourceTitle: 'Public', status: 'ready' },
    //             { id: 'pub-2', label: 'test', icon: 'MapPin', sourceTitle: 'Public', status: 'ready' },
    //             { id: 'pub-3', label: 'patch lead', icon: 'Square', sourceTitle: 'Public', status: 'ready' }
    //         ]
    //     }
    // })
    // const [isDragOver, setIsDragOver] = useState(false)
    // const editingNodeRef = useRef<HTMLDivElement>(null)

    // const handleCancelEdit = useCallback(() => {
    //     setEditingNodeId(null)
    //     setEditingIcon('MapPin')
    //     setEditingLabel('')
    // }, [])

    // useEffect(() => {
    //     const handleClickOutside = (event: MouseEvent) => {
    //         if (!editingNodeId || !editingNodeRef.current) return

    //         const target = event.target as HTMLElement

    //         if (editingNodeRef.current.contains(target)) {
    //             return
    //         }


    //         const selectContent = target.closest('[data-slot="select-content"]')
    //         if (selectContent) {
    //             return
    //         }


    //         let element: HTMLElement | null = target
    //         while (element && element !== document.body) {
    //             if (element.getAttribute('data-slot')?.includes('select')) {
    //                 return
    //             }
    //             if (element.hasAttribute('data-radix-select-content') ||
    //                 element.hasAttribute('data-radix-select-viewport') ||
    //                 element.hasAttribute('data-radix-select-item')) {
    //                 return
    //             }
    //             element = element.parentElement
    //         }

    //         handleCancelEdit()
    //     }

    //     if (editingNodeId) {
    //         document.addEventListener('mousedown', handleClickOutside)
    //     }

    //     return () => {
    //         document.removeEventListener('mousedown', handleClickOutside)
    //     }
    // }, [editingNodeId, handleCancelEdit])

    // const handleNodeClick = (nodeId: string) => {
    //     setSelectedNodeId(nodeId)
    // }

    // const handleNodeDoubleClick = () => {
    //     console.log('double click node')
    // }

    // const handleDragStart = (e: React.DragEvent, node: NodeData) => {
    //     const nodeData: NodeData = {
    //         ...node,
    //         sourceTitle: title
    //     }
    //     e.dataTransfer.setData('application/json', JSON.stringify(nodeData))
    //     e.dataTransfer.effectAllowed = 'move'
    // }

    // const handleDragOver = (e: React.DragEvent) => {
    //     e.preventDefault()
    //     e.dataTransfer.dropEffect = 'move'
    //     setIsDragOver(true)
    // }

    // const handleDragLeave = (e: React.DragEvent) => {
    //     e.preventDefault()
    //     setIsDragOver(false)
    // }

    // const handleDrop = (e: React.DragEvent) => {
    //     e.preventDefault()
    //     setIsDragOver(false)

    //     try {
    //         const nodeDataStr = e.dataTransfer.getData('application/json')
    //         if (!nodeDataStr) return

    //         const nodeData: NodeData = JSON.parse(nodeDataStr)

    //         if (nodeData.sourceTitle === title) {
    //             return
    //         }

    //         if (nodes.some(existing => existing.label === nodeData.label)) {
    //             return
    //         }

    //         // const isLoading = store.get<{ on: Function, off: Function }>('isLoading')
    //         // if (isLoading) {
    //         //     isLoading.on()
    //         // }

    //         const newNode: NodeData = {
    //             id: `${title.toLowerCase()}-${Date.now()}`,
    //             label: nodeData.label,
    //             icon: nodeData.icon,
    //             sourceTitle: title,
    //             status: 'pending'
    //         }

    //         setNodes(prev => [...prev, newNode])

    //         setTimeout(() => {
    //             setNodes(prev => prev.map(node => node.id === newNode.id ? { ...node, status: 'ready' } : node))
    //             // if (isLoading) {
    //             //     isLoading.off()
    //             //     toast.success('Node added successfully')
    //             // }
    //             toast.success('Node added successfully')
    //         }, 4000)

    //     } catch (error) {
    //         console.error('Error handling drop:', error)
    //         const isLoading = store.get<{ on: Function, off: Function }>('isLoading')
    //         if (isLoading) {
    //             isLoading.off()
    //         }
    //     }
    // }

    // const renderNodeItemsMenu = () => {
    //     return null
    // }

    // const renderIcon = (icon: 'MapPin' | 'Square') => {
    //     if (icon === 'MapPin') {
    //         return <MapPin className='w-4 h-4 mr-2 ml-3 text-gray-400' />
    //     } else {
    //         return <Square className='w-4 h-4 mr-2 ml-3 text-gray-400' />
    //     }
    // }

    // const renderEditingNode = () => (
    //     <div
    //         ref={editingNodeRef}
    //         className={cn(
    //             'flex items-center gap-2 py-1 px-2 text-sm w-full',
    //         )}
    //         style={{ paddingLeft: `${depth * 16 + 2}px` }}
    //     >
    //         <Select value={editingIcon} onValueChange={(value: 'MapPin' | 'Square') => setEditingIcon(value)}>
    //             <SelectTrigger className="w-20 !h-4 bg-gray-700 border-gray-600 text-xs">
    //                 <SelectValue />
    //             </SelectTrigger>
    //             <SelectContent>
    //                 <SelectItem value="MapPin">MapPin</SelectItem>
    //                 <SelectItem value="Square">Square</SelectItem>
    //             </SelectContent>
    //         </Select>
    //         <Input
    //             className="h-4 w-8 text-xs flex-1"
    //             value={editingLabel}
    //             onChange={(e) => setEditingLabel(e.target.value)}
    //             placeholder="Enter node name"
    //             autoFocus
    //             onKeyDown={(e) => {
    //                 if (e.key === 'Enter') {
    //                     handleConfirmEdit()
    //                 } else if (e.key === 'Escape') {
    //                     handleCancelEdit()
    //                 }
    //             }}
    //         />
    //     </div>
    // )

    // const handleFilePlusClick = () => {
    //     if (selectedNodeId) {
    //         const selectedNode = nodes.find(n => n.id === selectedNodeId)
    //         if (!selectedNode) {
    //             toast.error('The selected node does not exist')
    //             return
    //         }
    //     }

    //     const newEditingNodeId = `editing-${Date.now()}`
    //     setEditingNodeId(newEditingNodeId)
    //     setEditingIcon('MapPin')
    //     setEditingLabel('')
    // }

    // const handleConfirmEdit = () => {
    //     if (!editingNodeId) return

    //     if (!editingLabel.trim()) {
    //         toast.error('Please enter a node name')
    //         return
    //     }

    //     const newNode: NodeData = {
    //         id: `${title.toLowerCase()}-${Date.now()}`,
    //         label: editingLabel.trim(),
    //         icon: editingIcon,
    //         sourceTitle: title,
    //         status: 'ready'
    //     }

    //     const newNodes = [...nodes]

    //     if (selectedNodeId) {
    //         const selectedNode = nodes.find(n => n.id === selectedNodeId)
    //         if (selectedNode) {
    //             const selectedIndex = nodes.findIndex(n => n.id === selectedNodeId)
    //             newNodes.splice(selectedIndex + 1, 0, newNode)
    //         } else {
    //             newNodes.push(newNode)
    //         }
    //     } else {
    //         newNodes.push(newNode)
    //     }

    //     setNodes(newNodes)
    //     setEditingNodeId(null)
    //     setEditingIcon('MapPin')
    //     setEditingLabel('')
    //     toast.success('Node added successfully')
    // }

    // return (
    //     <>
    //         <div className='z-10 bg-[#2A2C33] py-1 pl-1 text-sm font-semibold flex items-center text-gray-200'>
    //             <span className='ml-2'>{title}</span>
    //             <div className='ml-auto mr-2'>
    //                 {title === 'WorkSpace' && (
    //                     <>
    //                         <Button
    //                             className='w-6 h-6 rounded-sm bg-[#2A2C33] hover:bg-[#363737] text-[#B8B8B8] cursor-pointer'
    //                             onClick={handleFilePlusClick}
    //                         >
    //                             <FilePlus className='w-4 h-4' />
    //                         </Button>
    //                         <Button className='w-6 h-6 rounded-sm bg-[#2A2C33] hover:bg-[#363737] text-[#B8B8B8] cursor-pointer'>
    //                             <FolderPlus className='w-4 h-4' />
    //                         </Button>
    //                     </>
    //                 )}
    //                 <Button className='w-6 h-6 rounded-sm bg-[#2A2C33] hover:bg-[#363737] text-[#B8B8B8] cursor-pointer'>
    //                     <RefreshCcw className='w-4 h-4' />
    //                 </Button>
    //             </div>
    //         </div>

    //         <div
    //             className={cn(
    //                 'min-h-[100px] transition-colors',
    //                 isDragOver ? 'bg-gray-800/50' : ''
    //             )}
    //             onDragOver={handleDragOver}
    //             onDragLeave={handleDragLeave}
    //             onDrop={handleDrop}
    //         >
    //             <ContextMenu>
    //                 <ContextMenuTrigger>
    //                     {nodes.map((node, index) => (
    //                         <div key={node.id}>
    //                             <div
    //                                 className={cn(
    //                                     'flex items-center py-0.5 px-2 hover:bg-gray-700 cursor-pointer text-sm w-full select-none',
    //                                     selectedNodeId === node.id ? 'bg-gray-600 text-white' : 'text-gray-300',
    //                                     node.status === 'pending' && 'bg-gray-800/80 text-gray-500 pointer-events-none'
    //                                 )}
    //                                 style={{ paddingLeft: `${depth * 16 + 2}px` }}
    //                                 onClick={() => handleNodeClick(node.id)}
    //                                 onDoubleClick={handleNodeDoubleClick}
    //                                 draggable={true}
    //                                 onDragStart={(e) => handleDragStart(e, node)}
    //                             >
    //                                 <div className='ml-2 flex'>
    //                                     {node.status === 'pending' ? (
    //                                         <Loader2 className='w-4 h-4 mr-2 ml-3 text-gray-400 animate-spin' />
    //                                     ) : (
    //                                         renderIcon(node.icon)
    //                                     )}
    //                                 </div>
    //                                 <span>{node.label}</span>
    //                             </div>
    //                             {editingNodeId && selectedNodeId === node.id && renderEditingNode()}
    //                         </div>
    //                     ))}
    //                     {editingNodeId && !selectedNodeId && renderEditingNode()}
    //                 </ContextMenuTrigger>

    //                 {/* Node Context Items Menu */}
    //                 {renderNodeItemsMenu()}
    //             </ContextMenu>
    //         </div>
    //     </>
    // )
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
                <TreeRenderer resourceTree={privateTree} title={"WorkSpace"} />
                <Separator className='my-2 bg-[#585858] w-full' />
                {/* Public */}
                <TreeRenderer resourceTree={publicTree} title={"Public"} />
            </div>
        </div>
    )
}
