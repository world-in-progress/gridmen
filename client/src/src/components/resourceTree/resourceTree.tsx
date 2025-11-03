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
} from 'lucide-react'
import { cn } from '@/utils/utils'
import { Separator } from "@/components/ui/separator"
import { IResourceNode } from '@/template/scene/iscene'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { useState } from 'react'
import { Button } from '../ui/button'


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

const TreeRenderer = ({ title }: TreeRendererProps) => {

    const depth = 0

    const [isSelected, setIsSelected] = useState(false)

    const handleNodeClick = () => {
        setIsSelected(true)
    }

    const handleNodeDoubleClick = () => {
        console.log('double click node')
    }

    const renderNodeItemsMenu = () => {
        return null
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

            {/* <NodeRenderer /> */}

            <ContextMenu>
                <ContextMenuTrigger>
                    <div

                        className={cn(
                            'flex items-center py-0.5 px-2 hover:bg-gray-700 cursor-pointer text-sm w-full select-none',
                            isSelected ? 'bg-gray-600 text-white' : 'text-gray-300',
                        )}
                        style={{ paddingLeft: `${depth * 16 + 2}px` }}
                        onClick={handleNodeClick}
                        onDoubleClick={handleNodeDoubleClick}
                        draggable={true} // Only allow dragging files, not folders
                        onDragStart={(e) => {
                            e.dataTransfer.setData('text/plain', 'schema test');
                            e.dataTransfer.effectAllowed = 'copy';
                        }}
                    >
                        <div className='ml-2 flex'>
                            <FileText className='w-4 h-4 mr-2 ml-3 text-gray-400' />
                        </div>
                        <span>schema test</span>
                    </div>
                    <div

                        className={cn(
                            'flex items-center py-0.5 px-2 hover:bg-gray-700 cursor-pointer text-sm w-full select-none',
                            isSelected ? 'bg-gray-600 text-white' : 'text-gray-300',
                        )}
                        style={{ paddingLeft: `${depth * 16 + 2}px` }}
                        onClick={handleNodeClick}
                        onDoubleClick={handleNodeDoubleClick}
                        draggable={true} // Only allow dragging files, not folders
                        onDragStart={(e) => {
                            e.dataTransfer.setData('text/plain', 'patch test');
                            e.dataTransfer.effectAllowed = 'copy';
                        }}
                    >
                        <div className='ml-2 flex'>
                            <FileText className='w-4 h-4 mr-2 ml-3 text-gray-400' />
                        </div>
                        <span>patch test</span>
                    </div>
                </ContextMenuTrigger>

                {/* Node Context Items Menu */}

                {renderNodeItemsMenu()}
            </ContextMenu>
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
