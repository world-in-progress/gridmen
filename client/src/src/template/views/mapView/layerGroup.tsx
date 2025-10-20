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
    ])

    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(["1", "2", "4"]))

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

    const renderLayer = (layer: Layer, depth = 0) => {
        const isExpanded = expandedGroups.has(layer.id)
        const hasChildren = layer.children && layer.children.length > 0

        return (
            <div key={layer.id} className="select-none">
                <div
                    className={cn(
                        "group flex items-center gap-1 px-2 py-1.5 hover:bg-white/5 cursor-pointer transition-colors",
                        depth > 0 && "ml-4",
                    )}
                    style={{ paddingLeft: `${depth * 16 + 8}px` }}
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
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <GripVertical className="w-4 h-4 text-gray-500" />
                    </div>
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
                <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-gray-200 hover:bg-white/10">
                        <Plus className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-gray-200 hover:bg-white/10">
                        <Settings className="w-4 h-4" />
                    </Button>
                </div>
            </div>

            {/* Toolbar */}
            <div className="px-2 py-2 border-b border-gray-800 flex items-center gap-1">
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-gray-400 hover:text-gray-200 hover:bg-white/10"
                >
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    Add Layer
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-gray-400 hover:text-gray-200 hover:bg-white/10"
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
