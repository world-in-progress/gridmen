import { useState } from "react"
import { ChevronDown, ChevronRight, Eye, EyeOff, Layers, Plus, Trash2, Settings, GripVertical } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/utils/utils"

interface Layer {
    id: string
    name: string
    visible: boolean
    type: "vector" | "raster" | "group"
    children?: Layer[]
    opacity?: number
}

export default function LayerGroup() {

    const [layers, setLayers] = useState<Layer[]>([
        {
            id: "1",
            name: "Base Maps",
            visible: true,
            type: "group",
            children: [
                { id: "1-1", name: "OpenStreetMap", visible: true, type: "raster", opacity: 100 },
                { id: "1-2", name: "Satellite", visible: false, type: "raster", opacity: 100 },
            ],
        },
        {
            id: "2",
            name: "Boundaries",
            visible: true,
            type: "group",
            children: [
                { id: "2-1", name: "Districts", visible: true, type: "vector", opacity: 80 },
                { id: "2-2", name: "Provinces", visible: true, type: "vector", opacity: 70 },
            ],
        },
        {
            id: "3",
            name: "Points of Interest",
            visible: false,
            type: "vector",
            opacity: 100,
        },
        {
            id: "4",
            name: "Transportation",
            visible: true,
            type: "group",
            children: [
                { id: "4-1", name: "Roads", visible: true, type: "vector", opacity: 90 },
                { id: "4-2", name: "Railways", visible: false, type: "vector", opacity: 85 },
                { id: "4-3", name: "Airports", visible: true, type: "vector", opacity: 100 },
            ],
        },
        {
            id: "5",
            name: "Resource Node",
            visible: true,
            type: "group",
            children: [],
        },
    ])

    const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null)
    const [dragOverLayerId, setDragOverLayerId] = useState<string | null>(null)
    const [dropPosition, setDropPosition] = useState<'before' | 'after' | 'inside' | null>(null)
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(["1", "2", "4", "5"]))

    const toggleExpanded = (id: string) => {
        setExpandedGroups((prev) => {
            const next = new Set(prev)
            if (next.has(id)) {
                next.delete(id)
            } else {
                next.add(id)
            }
            return next
        })
    }

    const toggleVisibility = (id: string, parentId?: string) => {
        setLayers((prev) => {
            const updateLayer = (layers: Layer[]): Layer[] => {
                return layers.map((layer) => {
                    if (layer.id === id) {
                        return { ...layer, visible: !layer.visible }
                    }
                    if (layer.children) {
                        return { ...layer, children: updateLayer(layer.children) }
                    }
                    return layer
                })
            }
            return updateLayer(prev)
        })
    }

    const findAndRemoveLayer = (layers: Layer[], layerId: string): { layers: Layer[], removedLayer: Layer | null } => {
        let removedLayer: Layer | null = null
        const newLayers = layers.filter(layer => {
            if (layer.id === layerId) {
                removedLayer = layer
                return false
            }
            return true
        }).map(layer => {
            if (layer.children) {
                const result = findAndRemoveLayer(layer.children, layerId)
                if (result.removedLayer) {
                    removedLayer = result.removedLayer
                }
                return { ...layer, children: result.layers }
            }
            return layer
        })
        return { layers: newLayers, removedLayer }
    }

    const insertLayer = (layers: Layer[], targetId: string, newLayer: Layer, position: 'before' | 'after' | 'inside'): Layer[] => {
        return layers.map(layer => {
            if (layer.id === targetId) {
                if (position === 'inside') {
                    return {
                        ...layer,
                        children: [...(layer.children || []), newLayer]
                    }
                }
            }
            if (layer.children) {
                return { ...layer, children: insertLayer(layer.children, targetId, newLayer, position) }
            }
            return layer
        }).flatMap((layer, index, arr) => {
            if (layer.id === targetId) {
                if (position === 'before') {
                    return [newLayer, layer]
                } else if (position === 'after') {
                    return [layer, newLayer]
                }
            }
            return [layer]
        })
    }

    const handleLayerDragStart = (e: React.DragEvent, layerId: string) => {
        e.stopPropagation()
        setDraggedLayerId(layerId)
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('application/layer-id', layerId)
    }

    const handleDrop = (e: React.DragEvent, targetLayerId: string) => {
        e.preventDefault()
        e.stopPropagation()

        const layerId = e.dataTransfer.getData('application/layer-id')
        const externalNodeName = e.dataTransfer.getData('text/plain')

        if (layerId && draggedLayerId) {
            if (layerId === targetLayerId) {
                setDragOverLayerId(null)
                setDraggedLayerId(null)
                setDropPosition(null)
                return
            }

            setLayers(prev => {
                const { layers: layersAfterRemove, removedLayer } = findAndRemoveLayer(prev, layerId)
                if (!removedLayer) return prev

                const position = dropPosition || 'inside'
                const newLayers = insertLayer(layersAfterRemove, targetLayerId, removedLayer, position)
                return newLayers
            })

            if (dropPosition === 'inside') {
                setExpandedGroups(prev => new Set(prev).add(targetLayerId))
            }
        }
        else if (externalNodeName) {
            const checkDuplicateName = (layers: Layer[], name: string): boolean => {
                for (const layer of layers) {
                    if (layer.name === name) return true
                    if (layer.children && checkDuplicateName(layer.children, name)) return true
                }
                return false
            }

            if (checkDuplicateName(layers, externalNodeName)) {
                console.warn(`Layer "${externalNodeName}" already exists`)
                setDragOverLayerId(null)
                return
            }

            const newLayer: Layer = {
                id: `resource-${Date.now()}`,
                name: externalNodeName,
                visible: true,
                type: "vector",
                opacity: 100
            }

            setLayers(prev => {
                const addToChildren = (layers: Layer[]): Layer[] => {
                    return layers.map(layer => {
                        if (layer.id === targetLayerId) {
                            return {
                                ...layer,
                                children: [...(layer.children || []), newLayer]
                            }
                        }
                        if (layer.children) {
                            return { ...layer, children: addToChildren(layer.children) }
                        }
                        return layer
                    })
                }
                return addToChildren(prev)
            })

            setExpandedGroups(prev => new Set(prev).add(targetLayerId))
        }

        setDragOverLayerId(null)
        setDraggedLayerId(null)
        setDropPosition(null)
    }

    const handleDragOver = (e: React.DragEvent, layerId: string, isGroup: boolean) => {
        e.preventDefault()
        e.stopPropagation()

        const layerDragData = e.dataTransfer.types.includes('application/layer-id')
        const externalDragData = e.dataTransfer.types.includes('text/plain')

        if (layerDragData) {
            e.dataTransfer.dropEffect = 'move'
        } else if (externalDragData) {
            e.dataTransfer.dropEffect = 'copy'
        }

        setDragOverLayerId(layerId)

        const rect = e.currentTarget.getBoundingClientRect()
        const y = e.clientY - rect.top
        const height = rect.height

        if (isGroup) {
            setDropPosition('inside')
        } else {
            if (y < height * 0.33) {
                setDropPosition('before')
            } else if (y > height * 0.67) {
                setDropPosition('after')
            } else {
                setDropPosition('inside')
            }
        }
    }

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setDragOverLayerId(null)
        setDropPosition(null)
    }

    const handleDragEnd = () => {
        setDraggedLayerId(null)
        setDragOverLayerId(null)
        setDropPosition(null)
    }

    const renderLayer = (layer: Layer, depth = 0) => {
        const isExpanded = expandedGroups.has(layer.id)
        const hasChildren = layer.children && layer.children.length > 0
        const isResourceNode = layer.name === "Resource Node"
        const isDragOver = dragOverLayerId === layer.id
        const isDragging = draggedLayerId === layer.id
        const isGroup = layer.type === "group"

        return (
            <div key={layer.id} className="select-none relative">
                {/* Drop position indicator */}
                {isDragOver && dropPosition === 'before' && (
                    <div className="absolute top-0 left-0 right-0 h-0.5 bg-blue-400 z-10" />
                )}
                {isDragOver && dropPosition === 'after' && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-400 z-10" />
                )}

                <div
                    draggable={!isResourceNode}
                    onDragStart={(e) => !isResourceNode && handleLayerDragStart(e, layer.id)}
                    onDragEnd={handleDragEnd}
                    className={cn(
                        "group flex items-center gap-1 px-2 py-1.5 hover:bg-white/5 cursor-pointer transition-colors relative",
                        depth > 0 && "ml-4",
                        isDragOver && dropPosition === 'inside' && "bg-blue-500/20 border border-blue-400 border-dashed",
                        isDragging && "opacity-50"
                    )}
                    style={{ paddingLeft: `${depth * 16 + 8}px` }}
                    onDrop={(e) => handleDrop(e, layer.id)}
                    onDragOver={(e) => handleDragOver(e, layer.id, isGroup || isResourceNode)}
                    onDragLeave={handleDragLeave}
                >
                    {/* Expand/Collapse Icon */}
                    <div className="w-4 h-4 flex items-center justify-center">
                        {hasChildren && (
                            <button onClick={() => toggleExpanded(layer.id)} className="hover:bg-white/10 rounded">
                                {isExpanded ? (
                                    <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                                ) : (
                                    <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
                                )}
                            </button>
                        )}
                    </div>

                    {/* Visibility Toggle */}
                    <button
                        onClick={() => toggleVisibility(layer.id)}
                        className="w-5 h-5 flex items-center justify-center hover:bg-white/10 rounded"
                    >
                        {layer.visible ? <Eye className="w-4 h-4 text-blue-400" /> : <EyeOff className="w-4 h-4 text-gray-500" />}
                    </button>

                    {/* Layer Icon */}
                    <div className="w-4 h-4 flex items-center justify-center">
                        <Layers className="w-3.5 h-3.5 text-gray-400" />
                    </div>

                    {/* Layer Name */}
                    <span className={cn("flex-1 text-sm truncate", layer.visible ? "text-gray-200" : "text-gray-500")}>
                        {layer.name}
                    </span>

                    {/* Drag Handle */}
                    {!isResourceNode && (
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                            <GripVertical className="w-4 h-4 text-gray-500 cursor-grab active:cursor-grabbing" />
                        </div>
                    )}
                </div>

                {/* Render Children */}
                {hasChildren && isExpanded && <div>{layer.children!.map((child) => renderLayer(child, depth + 1))}</div>}
            </div>
        )
    }

    return (
        <div className="w-full h-full bg-[#1e1e1e] border-r border-gray-800 flex flex-col">
            {/* Header */}
            <div className="px-3 py-2.5 border-b border-gray-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-gray-400" />
                    <h2 className="text-sm font-semibold text-gray-200">Layers</h2>
                </div>
            </div>

            {/* Toolbar */}
            <div className="px-2 py-2 border-b border-gray-800 flex items-center gap-1">
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-gray-400 hover:text-gray-200 hover:bg-white/10 cursor-pointer"
                >
                    <Eye className="w-3.5 h-3.5 mr-1" />
                    Show All
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-gray-400 hover:text-gray-200 hover:bg-white/10 cursor-pointer"
                >
                    <Trash2 className="w-3.5 h-3.5 mr-1" />
                    Remove
                </Button>
            </div>

            {/* Layer List */}
            <ScrollArea className="flex-1">
                <div className="py-1">{layers.map((layer) => renderLayer(layer))}</div>
            </ScrollArea>

            {/* Footer Info */}
            <div className="px-3 py-2 border-t border-gray-800 text-xs text-gray-500">
                <div className="flex justify-between">
                    <span>Total Layers: {layers.length}</span>
                    <span>CRS: EPSG:4326</span>
                </div>
            </div>
        </div>
    )
}
