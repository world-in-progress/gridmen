import {
    Folder,
    FileText,
    FolderOpen,
    ChevronDown,
    ChevronRight,
} from 'lucide-react'
import { cn } from '@/utils/utils'
import { Separator } from "@/components/ui/separator"
import { IResourceNode } from '@/template/scene/iscene'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'


interface NodeRendererProps {
    node: IResourceNode
}

interface TreeRendererProps {
    title: string
}

const NodeRenderer = ({ node }: NodeRendererProps) => {

    // const tree = node.tree as

    //     const isSelected = 


    return (
        <div>
            <ContextMenu>
                <ContextMenuTrigger>
                    <div
                        className={cn(
                            'flex items-center py-0.5 px-2 hover:bg-gray-700 cursor-pointer text-sm w-full select-none',
                            isSelected ? 'bg-gray-600 text-white' : 'text-gray-300',
                        )}
                        style={{ paddingLeft: `${depth * 16 + 2}px` }}
                        onClick={handleClick}
                        onDoubleClick={handleDoubleClick}
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

const TreeRenderer = ({ title }: TreeRendererProps) => {
    return (
        <>
            <div className='z-10 bg-[#2A2C33] py-1 pl-1 text-sm font-semibold text-gray-200'>
                <span className='ml-2'>{title}</span>
            </div>
            {/* <NodeRenderer /> */}
        </>
    )
}


export default function ResourceTree() {
    return (
        <div className="flex h-full bg-[#252526] overflow-y-auto">
            <div className="w-full">
                <div className='text-sm font-semibold text-gray-400 py-2 ml-2 tracking-wide'>
                    EXPLORER
                </div>
                {/* Workspace */}
                <TreeRenderer title={"Workspace"} />

                <Separator className='my-2 bg-[#585858] w-full' />

                {/* Public */}
                <TreeRenderer title={"Public"} />
            </div>
        </div>
    )
}
