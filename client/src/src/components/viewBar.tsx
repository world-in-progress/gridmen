import React, { useRef } from 'react'
import { cn } from '@/utils/utils'
import { Button } from './ui/button'
import { Cloudy, FileText, User, X, Plus } from 'lucide-react'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { DragDropContext, Droppable, Draggable, DragStart, DropResult } from '@hello-pangea/dnd'
import { ResourceNode } from './resourceScene/scene'

interface RenderViewTabProps {
    viewNode: ResourceNode
    index: number
    onTabClick: (tab: Tab) => void
}

const RenderViewTab: React.FC<RenderViewTabProps> = ({
    viewNode,
    index,
    onTabClick
}: RenderViewTabProps) => {

    const tab = viewNode.tab 
    const tabId = 'view-tab'

    return (
        <Draggable key={tabId} draggableId={tabId} index={index}>
            {(providedDraggable, snapshot) => (
                <div
                    onClick={() => {
                        onTabClick(tab)
                    }}
                    ref={providedDraggable.innerRef}
                    {...providedDraggable.draggableProps}
                    {...providedDraggable.dragHandleProps}
                    tab-id={viewNode.id}
                >
                    <div
                        title={`${viewNode.key} · ${viewNode.tree.isPublic ? 'PUBLIC' : 'PRIVATE'}`}
                        className={cn(
                            'group flex items-center px-4 bg-[#2D2D2D] border-r border-[#252526] cursor-pointer h-[4vh]',
                            isFocused && 'bg-[#1E1E1E]',
                            snapshot.isDragging && 'bg-gray-600'
                        )}
                    >
                        {tab.name === "user" ? (
                            <User className="w-4 h-4 mr-2 flex-shrink-0 text-blue-400" />
                        ) : (
                            <FileText className="w-4 h-4 mr-2 flex-shrink-0 text-blue-400" />
                        )}
                        <span
                            className={cn(
                                "text-sm truncate text-gray-300 px-0.5 flex items-center",
                                tab.isPreview && "italic"
                            )}
                        >
                            {tab.name}
                            {node.tree.isPublic && <Cloudy className='w-4 h-4 ml-2 text-gray-300' />}
                        </span>

                        <X
                            className={cn(
                                'w-4 h-4 ml-2',
                                isFocused
                                    ? 'text-white hover:text-amber-400'
                                    : 'text-gray-500 hover:text-white invisible group-hover:visible'
                            )}
                            onClick={(e) => {
                                e.stopPropagation()
                                node.tree.stopEditingNode(node)
                            }}
                        />
                    </div>
                </div>
            )}
        </Draggable>
    )
}


interface Tab {
    name: string
    isPreview?: boolean
}

const RenderViewTabs: React.FC<{
    tabs: Tab[]
}> = ({
    tabs
}) => {

        // const elements = 

        return (
            <div className='flex items-center gap-2'>
                <div>你好</div>
                <Button variant='ghost' size='icon' className='w-6 h-6 cursor-pointer'>
                    <Plus />
                </Button>
            </div>
        )
    }



interface ViewBarProps {
    width?: number
    tabs: Tab[]
    onTabDragEnd: (result: DropResult) => void
}

export default function ViewBar({
    width,
    tabs,
    onTabDragEnd
}: ViewBarProps) {

    const scrollAreaRef = useRef<HTMLDivElement>(null)

    const handleDragStart = (start: DragStart) => {

    }


    return (
        <div
            className='bg-[#252526] flex shrink-0 h-[4vh]'
            style={{ width: width ? `${width}px` : '[84.5%]' }}
        >
            <ScrollArea ref={scrollAreaRef} className='w-full h-full'>
                <DragDropContext onDragStart={handleDragStart} onDragEnd={onTabDragEnd}>
                    <Droppable droppableId='tabs' direction='horizontal'>
                        {(provided) => (
                            <div
                                ref={provided.innerRef}
                                {...provided.droppableProps}
                                className='flex'
                            >
                                <RenderViewTabs tabs={tabs} />
                                {provided.placeholder}
                            </div>
                        )}
                    </Droppable>
                </DragDropContext>
                <ScrollBar orientation='horizontal' />
            </ScrollArea>
        </div>
    )
}
