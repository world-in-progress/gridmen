import {
    Folder,
    FileText,
    FolderOpen,
    ChevronDown,
    ChevronRight,
    Plus,
    FilePlus,
    FolderPlus,
    RefreshCcw,
    MapPin,
    Square,
} from 'lucide-react'
import { cn } from '@/utils/utils'
import { Separator } from "@/components/ui/separator"
import { IResourceNode } from '@/template/scene/iscene'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { useState } from 'react'
import { Button } from '../ui/button'
import store from '@/store'
import { toast } from 'sonner'


interface NodeRendererProps {
    node: IResourceNode
}

interface TreeRendererProps {
    title: string
}

// const NodeRenderer = ({ node }: NodeRendererProps) => {

//     // const tree = node.tree as

//     //     const isSelected = 


//     return (
//         <div>
//             <ContextMenu>
//                 <ContextMenuTrigger>
//                 </ContextMenuTrigger>
//                 {renderNodeMenu()}
//             </ContextMenu>

//             {/* Render child nodes */}
//             {isFolder && isExpanded && node.children && (
//                 <div>
//                     {Array.from(node.children.values()).map(childNode => (
//                         <NodeRenderer
//                             key={childNode.id}
//                             node={childNode}
//                             privateTree={privateTree}
//                             publicTree={publicTree}
//                             depth={depth + 1}
//                             triggerFocus={triggerFocus}
//                         />
//                     ))}
//                 </div>
//             )}
//         </div>
//     )
// }

interface NodeData {
    id: string
    label: string
    icon: 'MapPin' | 'Square'
    sourceTitle: string
}

const TreeRenderer = ({ title }: TreeRendererProps) => {

    const depth = 0

    const [isSelected, setIsSelected] = useState(false)
    const [nodes, setNodes] = useState<NodeData[]>(() => {
        // 初始化节点数据
        if (title === 'WorkSpace') {
            return [
                { id: 'ws-1', label: '111', icon: 'MapPin', sourceTitle: 'WorkSpace' },
                { id: 'ws-2', label: '222', icon: 'MapPin', sourceTitle: 'WorkSpace' }
            ]
        } else {
            return [
                { id: 'pub-1', label: 'schema lead', icon: 'MapPin', sourceTitle: 'Public' },
                { id: 'pub-2', label: 'test', icon: 'MapPin', sourceTitle: 'Public' },
                { id: 'pub-3', label: 'patch lead', icon: 'Square', sourceTitle: 'Public' }
            ]
        }
    })
    const [isDragOver, setIsDragOver] = useState(false)

    const handleNodeClick = () => {
        setIsSelected(true)
    }

    const handleNodeDoubleClick = () => {
        console.log('double click node')
    }

    const handleDragStart = (e: React.DragEvent, node: NodeData) => {
        const nodeData: NodeData = {
            ...node,
            sourceTitle: title
        }
        e.dataTransfer.setData('application/json', JSON.stringify(nodeData))
        e.dataTransfer.effectAllowed = 'move'
    }

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setIsDragOver(true)
    }

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragOver(false)
    }

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragOver(false)

        try {
            const nodeDataStr = e.dataTransfer.getData('application/json')
            if (!nodeDataStr) return

            const nodeData: NodeData = JSON.parse(nodeDataStr)

            // 如果是从同一个 TreeRenderer 拖放，不处理
            if (nodeData.sourceTitle === title) {
                return
            }

            // 如果目标树中已存在同名节点，则不重复添加
            if (nodes.some(existing => existing.label === nodeData.label)) {
                return
            }

            // 触发 loading
            const isLoading = store.get<{ on: Function, off: Function }>('isLoading')
            if (isLoading) {
                isLoading.on()
            }

            // 添加节点到目标 TreeRenderer（创建新节点，避免引用问题）
            const newNode: NodeData = {
                id: `${title.toLowerCase()}-${Date.now()}`,
                label: nodeData.label,
                icon: nodeData.icon,
                sourceTitle: title
            }


            // 4秒后关闭 loading
            setTimeout(() => {
                if (isLoading) {
                    isLoading.off()
                    setNodes(prev => [...prev, newNode])
                    toast.success('Node added successfully')
                }
            }, 4000)

        } catch (error) {
            console.error('Error handling drop:', error)
            const isLoading = store.get<{ on: Function, off: Function }>('isLoading')
            if (isLoading) {
                isLoading.off()
            }
        }
    }

    const renderNodeItemsMenu = () => {
        return null
    }

    const renderIcon = (icon: 'MapPin' | 'Square') => {
        if (icon === 'MapPin') {
            return <MapPin className='w-4 h-4 mr-2 ml-3 text-gray-400' />
        } else {
            return <Square className='w-4 h-4 mr-2 ml-3 text-gray-400' />
        }
    }

    return (
        <>
            <div className='z-10 bg-[#2A2C33] py-1 pl-1 text-sm font-semibold flex items-center text-gray-200'>
                <span className='ml-2'>{title}</span>
                <div className='ml-auto mr-2'>
                    {title === 'WorkSpace' && (
                        <>
                            <Button className='w-6 h-6 rounded-sm bg-[#2A2C33] hover:bg-[#363737] text-[#B8B8B8] cursor-pointer'>
                                <FilePlus className='w-4 h-4' />
                            </Button>
                            <Button className='w-6 h-6 rounded-sm bg-[#2A2C33] hover:bg-[#363737] text-[#B8B8B8] cursor-pointer'>
                                <FolderPlus className='w-4 h-4' />
                            </Button>
                        </>
                    )}
                    <Button className='w-6 h-6 rounded-sm bg-[#2A2C33] hover:bg-[#363737] text-[#B8B8B8] cursor-pointer'>
                        <RefreshCcw className='w-4 h-4' />
                    </Button>
                </div>
            </div>

            <div
                className={cn(
                    'min-h-[100px] transition-colors',
                    isDragOver ? 'bg-gray-800/50' : ''
                )}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                <ContextMenu>
                    <ContextMenuTrigger>
                        {nodes.map((node) => (
                            <div
                                key={node.id}
                                className={cn(
                                    'flex items-center py-0.5 px-2 hover:bg-gray-700 cursor-pointer text-sm w-full select-none',
                                    isSelected ? 'bg-gray-600 text-white' : 'text-gray-300',
                                )}
                                style={{ paddingLeft: `${depth * 16 + 2}px` }}
                                onClick={handleNodeClick}
                                onDoubleClick={handleNodeDoubleClick}
                                draggable={true}
                                onDragStart={(e) => handleDragStart(e, node)}
                            >
                                <div className='ml-2 flex'>
                                    {renderIcon(node.icon)}
                                </div>
                                <span>{node.label}</span>
                            </div>
                        ))}
                    </ContextMenuTrigger>

                    {/* Node Context Items Menu */}
                    {renderNodeItemsMenu()}
                </ContextMenu>
            </div>
        </>
    )
}

interface ResourceTreeComponentProps {
    onNodeMenuOpen: (node: IResourceNode) => void
    onNodeRemove: (node: IResourceNode) => void
    onNodeClick: (node: IResourceNode) => void
    onNodeDoubleClick: (node: IResourceNode) => void
}

export default function ResourceTreeComponent({
    onNodeMenuOpen,
    onNodeRemove,
    onNodeClick,
    onNodeDoubleClick
}: ResourceTreeComponentProps) {
    return (
        <div className="flex h-full bg-[#252526] overflow-y-auto">
            <div className="w-full">
                <div className='text-sm font-semibold text-gray-400 py-2 ml-2 tracking-wide'>
                    EXPLORER
                </div>
                {/* WorkSpace */}
                <TreeRenderer title={"WorkSpace"} />

                <Separator className='my-2 bg-[#585858] w-full' />

                {/* Public */}
                <TreeRenderer title={"Public"} />
            </div>
        </div>
    )
}
