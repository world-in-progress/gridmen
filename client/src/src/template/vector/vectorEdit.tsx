import {
    SplinePointer,
    Pencil,
    Trash2,
    Undo2,
    Redo2,
    MousePointer,
    Dot,
    Minus,
    Square,
    Globe,
    Palette,
} from "lucide-react"
import {
    Select,
    SelectItem,
    SelectValue,
    SelectContent,
    SelectTrigger,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import type { IResourceNode } from "../scene/iscene"
import type { IViewContext } from "@/views/IViewContext"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { useCallback, useEffect, useReducer, useRef, useState } from "react"
import { ResourceNode, ResourceTree } from "../scene/scene"
import * as api from "../api/apis"
import { Badge } from "@/components/ui/badge"
import { MapViewContext } from "@/views/mapView/mapView"
import { toast } from "sonner"
import { linkNode } from "../api/node"
import { useLayerGroupStore, useToolPanelStore } from "@/store/storeSet"
import { toValidFeatureCollection } from "@/utils/utils"

interface VectorEditProps {
    node: IResourceNode
    context: IViewContext
}

interface PageContext {
    hasVector: boolean
    drawVector: GeoJSON.FeatureCollection | null
    vectorData: {
        type: "point" | "line" | "polygon"
        name: string
        epsg: string
        color: string
    }
}

type ToolType = "select" | "draw"

const vectorTips = [
    { tip1: "Fill in the name of the Schema and the EPSG code." },
    { tip2: "Description is optional." },
    { tip3: "Click the button to draw and obtain or manually fill in the coordinates of the reference point." },
    { tip4: "Set the grid size for each level." },
]

const vectorColorMap = [
    { value: "sky-500", color: "#0ea5e9", name: "Sky" },
    { value: "green-500", color: "#22c55e", name: "Green" },
    { value: "red-500", color: "#ef4444", name: "Red" },
    { value: "purple-500", color: "#a855f7", name: "Purple" },
    { value: "yellow-300", color: "#FFDF20", name: "Yellow" },
    { value: "orange-500", color: "#FF6900", name: "Orange" },
    { value: "pink-500", color: "#ec4899", name: "Pink" },
    { value: "indigo-500", color: "#6366f1", name: "Indigo" }
]

const getHexColorByValue = (value: string) => {
    return vectorColorMap.find((item) => item.value === value)?.color ?? "#0ea5e9"
}

const guessVectorTypeFromFeatureCollection = (fc: any): "point" | "line" | "polygon" => {
    const features = Array.isArray(fc?.features) ? fc.features : []
    const firstGeomType = features?.[0]?.geometry?.type
    if (firstGeomType === "Point" || firstGeomType === "MultiPoint") return "point"
    if (firstGeomType === "LineString" || firstGeomType === "MultiLineString") return "line"
    if (firstGeomType === "Polygon" || firstGeomType === "MultiPolygon") return "polygon"
    return "polygon"
}

const getDrawModeByType = (type: "point" | "line" | "polygon") => {
    switch (type) {
        case "point":
            return "draw_point"
        case "line":
            return "draw_line_string"
        case "polygon":
            return "draw_polygon"
        default:
            return "simple_select"
    }
}

const getVectorTypeIcon = (type: string) => {
    switch (type) {
        case "point":
            return <Dot className="w-6 h-6 text-blue-500" />
        case "line":
            return <Minus className="w-6 h-6 text-green-500" />
        case "polygon":
            return <Square className="w-6 h-6 text-purple-500" />
        default:
            return null
    }
}

export default function VectorEdit({ node, context }: VectorEditProps) {
    const mapContext = context as MapViewContext
    const map = mapContext.map!
    const drawInstance = mapContext.drawInstance!

    const pageContext = useRef<PageContext>({
        hasVector: false,
        drawVector: null,
        vectorData: {
            type: "polygon",
            name: "",
            epsg: "4326",
            color: "sky-500",
        },
    })

    const [selectedTool, setSelectedTool] = useState<ToolType>("select")
    const selectedToolRef = useRef<ToolType>("select")
    const [, triggerRepaint] = useReducer((x) => x + 1, 0)

    useEffect(() => {
        loadContext()
        return () => {
            unloadContext()
        }
    }, [])

    const loadContext = async () => {
        pageContext.current.vectorData.name = node.name.split(".")[0]

        if (!(node as ResourceNode).lockId) {
            const linkResponse = await linkNode("gridmen/IVector/1.0.0", node.nodeInfo, "w")
                ; (node as ResourceNode).lockId = linkResponse.lock_id
        }

        const lockId = (node as ResourceNode).lockId!
        const res = await api.vector.getVector(node.nodeInfo, lockId)
        const data = res.data as any

        const epsg = String(data?.epsg ?? "4326")
        const color = String(data?.color ?? "sky-500")
        const featureJson = data?.feature_json

        pageContext.current.vectorData.epsg = epsg?.trim() ? epsg : "4326"
        pageContext.current.vectorData.color = color
        pageContext.current.vectorData.type = guessVectorTypeFromFeatureCollection(featureJson)

        if (featureJson?.type === "FeatureCollection") {
            pageContext.current.drawVector = featureJson
            pageContext.current.hasVector = Array.isArray(featureJson.features) && featureJson.features.length > 0
        }

        try {
            if (featureJson) {
                const hex = getHexColorByValue(pageContext.current.vectorData.color)
                const valid = toValidFeatureCollection(featureJson, hex)
                if (valid.features.length > 0) {
                    drawInstance.add(valid as any)
                    applyVectorColorToDraw(hex)
                }
            }
        } catch (e) {
            console.warn("Failed to load vector into draw:", e)
        }

        (node as ResourceNode).context = {
            ...((node as ResourceNode).context ?? {}),
            __cleanup: {
                ...(((node as ResourceNode).context as any)?.__cleanup ?? {}),
                vector: () => drawInstance?.deleteAll(),
            },
        }

        triggerRepaint()
    }

    const unloadContext = () => {
        // const drawInstance = store.get<MapboxDraw>("mapDraw")

        // if (pageContext.current!.hasVector) {
        //     if (drawInstance) {
        //         handleSaveVector()
        //     }
        // }
    }

    const setSelectedToolSafe = useCallback((tool: ToolType) => {
        selectedToolRef.current = tool
        setSelectedTool(tool)
    }, [])

    const safeChangeMode = useCallback(
        (mode: string, modeOptions?: any) => {
            try {
                ; (drawInstance as any)?.changeMode?.(mode, modeOptions)
            } catch (e) {
                console.warn("Failed to change draw mode:", e)
            }
        },
        [drawInstance]
    )

    const applyVectorColorToDraw = useCallback(
        (hexColor: string) => {
            if (!drawInstance) return
            const all = drawInstance.getAll()
            for (const feature of all.features as any[]) {
                if (!feature?.id) continue
                drawInstance.setFeatureProperty(feature.id, "user_color", hexColor)
            }
        },
        [drawInstance]
    )

    const syncDrawVectorFromDraw = useCallback(() => {
        if (!drawInstance) return
        const all = drawInstance.getAll()
        pageContext.current.drawVector = all
        pageContext.current.hasVector = all.features.length > 0
        triggerRepaint()
    }, [drawInstance])

    useEffect(() => {
        if (!map || !drawInstance) return

        const onCreate = (e: any) => {
            const hex = getHexColorByValue(pageContext.current.vectorData.color)
            if (e?.features && Array.isArray(e.features)) {
                for (const f of e.features) {
                    if (!f?.id) continue
                    drawInstance.setFeatureProperty(f.id, "user_color", hex)
                }
            }
            syncDrawVectorFromDraw()

            if (selectedToolRef.current === "draw") {
                const mode = getDrawModeByType(pageContext.current.vectorData.type)
                setTimeout(() => safeChangeMode(mode), 0)
            }
        }

        const onUpdate = (e: any) => {
            const hex = getHexColorByValue(pageContext.current.vectorData.color)
            if (e?.features && Array.isArray(e.features)) {
                for (const f of e.features) {
                    if (!f?.id) continue
                    drawInstance.setFeatureProperty(f.id, "user_color", hex)
                }
            }
            syncDrawVectorFromDraw()
        }

        const onDelete = () => {
            syncDrawVectorFromDraw()
        }

        map.on("draw.create", onCreate)
        map.on("draw.update", onUpdate)
        map.on("draw.delete", onDelete)

        return () => {
            map.off("draw.create", onCreate)
            map.off("draw.update", onUpdate)
            map.off("draw.delete", onDelete)
        }
    }, [drawInstance, map, safeChangeMode, syncDrawVectorFromDraw])

    const handleClickDraw = useCallback(() => {
        setSelectedToolSafe("draw")
        const mode = getDrawModeByType(pageContext.current.vectorData.type)
        safeChangeMode(mode)
    }, [safeChangeMode, setSelectedToolSafe])

    const handleClickSelect = useCallback(() => {
        setSelectedToolSafe("select")
        safeChangeMode("simple_select")
    }, [safeChangeMode, setSelectedToolSafe])

    const handleDeleteSelected = useCallback(() => {
        if (selectedToolRef.current !== "select") return
        try {
            ; (drawInstance as any)?.trash?.()
        } catch (e) {
            console.warn("Failed to delete selected features:", e)
        }
        syncDrawVectorFromDraw()
    }, [drawInstance, syncDrawVectorFromDraw])

    useEffect(() => {
        const isEditableTarget = (target: EventTarget | null) => {
            const el = target as HTMLElement | null
            if (!el) return false
            if (el.isContentEditable) return true
            const tag = el.tagName?.toUpperCase()
            return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented) return

            if (event.ctrlKey || event.metaKey) {
                if (event.key === "D" || event.key === "d") {
                    event.preventDefault()
                    handleClickDraw()
                    return
                }
                if (event.key === "S" || event.key === "s") {
                    event.preventDefault()
                    handleClickSelect()
                    return
                }
            }
            if (event.key === "Delete") {
                if (isEditableTarget(event.target)) return
                event.preventDefault()
                handleDeleteSelected()
            }
        }

        window.addEventListener("keydown", handleKeyDown)
        return () => window.removeEventListener("keydown", handleKeyDown)
    }, [handleClickDraw, handleClickSelect, handleDeleteSelected])

    const handleUpdateVector = useCallback(async (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault()
        e.stopPropagation()

        const lockId = (node as ResourceNode).lockId
        if (!lockId) {
            toast.error("Vector lockId not ready")
            return
        }

        if (!pageContext.current.vectorData.epsg.trim()) {
            toast.error("EPSG is required")
            return
        }

        const rawFeatureJson = drawInstance.getAll()
        const hex = getHexColorByValue(pageContext.current.vectorData.color)

        const featureJson = toValidFeatureCollection(rawFeatureJson, hex)
        const updateData = {
            color: pageContext.current.vectorData.color,
            epsg: pageContext.current.vectorData.epsg,
            feature_json: featureJson as any,
        }

        console.log('draw featureJson:', featureJson)

        setSelectedToolSafe('select')
        safeChangeMode('simple_select')
        drawInstance.deleteAll()
        pageContext.current.drawVector = null
        pageContext.current.hasVector = false
        triggerRepaint()

        try {
            await api.vector.updateVector(node.nodeInfo, lockId, updateData)

            node.isTemp = false
                ; (node as ResourceNode).tree.tempNodeExist = false
                ; (node.tree as ResourceTree).selectedNode = null
                ; (node.tree as ResourceTree).notifyDomUpdate()

            const { isEditMode } = useLayerGroupStore.getState()
            useToolPanelStore.getState().setActiveTab(isEditMode ? 'edit' : 'check')

            await (node.tree as ResourceTree).refresh()

            toast.success("Vector updated successfully")
        } catch (error) {
            console.error("Failed to update vector:", error)
            toast.error(`Failed to update vector: ${error}`)
        }
    }, [drawInstance, node, safeChangeMode, setSelectedToolSafe])

    return (
        <div className="w-full h-full flex flex-col">
            <>
                <div className='flex-none w-full border-b border-gray-700 flex flex-col'>
                    <div className="w-full flex justify-center items-center gap-4 p-4">
                        <Avatar className="h-10 w-10 border-2 border-white">
                            <AvatarFallback className="bg-[#007ACC]">
                                <SplinePointer className="h-6 w-6 text-white" />
                            </AvatarFallback>
                        </Avatar>
                        <h1 className="font-bold text-[25px] relative flex items-center text-white">
                            Edit Vector
                            <span className="bg-[#D63F26] rounded px-0.5 mb-2 text-[12px] inline-flex items-center mx-1">
                                WorkSpace
                            </span>
                        </h1>
                    </div>

                    <div className="w-full p-4 pb-2 space-y-2 -mt-2 text-white">
                        <div className="text-sm px-4">
                            <ul className="list-disc space-y-1">
                                {vectorTips.map((tip, index) => (
                                    <li key={index}>{Object.values(tip)[0]}</li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto min-h-0 scrollbar-hide">
                    <div className="border-b border-gray-700">
                        <div className="w-full p-4 space-y-4 border-t border-gray-700">
                            <div>
                                <h3 className="text-white font-semibold mb-2">Drawing Mode</h3>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        onClick={handleClickDraw}
                                        className={`${selectedTool === "draw"
                                            ? "bg-orange-500 hover:bg-orange-600"
                                            : "bg-slate-700/50 hover:bg-slate-600/50 border border-slate-600"}
                                                text-white px-4 py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-all cursor-pointer`}
                                    >
                                        <Pencil className="h-4 w-4" />
                                        <span>Draw</span>
                                        <span className="text-xs opacity-80">[ Ctrl+D ]</span>
                                    </button>
                                    <button
                                        onClick={handleClickSelect}
                                        className={`${selectedTool === "select"
                                            ? "bg-orange-500 hover:bg-orange-600"
                                            : "bg-slate-700/50 hover:bg-slate-600/50 border border-slate-600"}
                                                text-white px-4 py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-all cursor-pointer`}
                                    >
                                        <MousePointer className="h-4 w-4" />
                                        <span>Select</span>
                                        <span className="text-xs opacity-80">[ Ctrl+S ]</span>
                                    </button>
                                </div>
                            </div>

                            <div>
                                <h3 className="text-white font-semibold mb-2">Operations</h3>
                                <div className="grid grid-cols-3 gap-2">
                                    <button className="bg-slate-700/50 hover:bg-slate-400/50 border border-slate-600 text-white px-2 py-1 rounded-lg font-medium flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer">
                                        <Undo2 className="h-4 w-4" />
                                        <span>Undo</span>
                                        <span className="text-xs opacity-80">[ Ctrl+Z ]</span>
                                    </button>
                                    <button className="bg-slate-700/50 hover:bg-slate-400/50 border border-slate-600 text-white px-2 py-1 rounded-lg font-medium flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer">
                                        <Redo2 className="h-4 w-4" />
                                        <span>Redo</span>
                                        <span className="text-xs opacity-80">[ Ctrl+Y ]</span>
                                    </button>
                                    <button
                                        onClick={handleDeleteSelected}
                                        disabled={selectedTool !== "select"}
                                        className={`${selectedTool === "select"
                                            ? "bg-red-500 hover:bg-red-600 cursor-pointer"
                                            : "bg-slate-700/50 border border-slate-600 opacity-50 cursor-not-allowed"}
                                                text-white px-2 py-1 rounded-lg font-medium flex flex-col items-center justify-center gap-0.5 transition-all`}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                        <span>Delete</span>
                                        <span className="text-xs opacity-80">[ Del ]</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="px-4 py-2 space-y-2">
                        <div className="space-y-1">
                            <h3 className="text-white font-semibold text-lg flex items-center gap-2">
                                <Palette className="w-5 h-5" />
                                Vector Basic Information
                            </h3>
                            <p className="text-slate-400 text-sm">Configure the properties for your new vector</p>
                        </div>
                        <div className="border-slate-200 border bg-white p-4 rounded-lg shadow-sm">
                            <div className="space-y-2">
                                <div className="space-y-2">
                                    <Label htmlFor="vectorName" className="text-sm font-medium text-slate-900">
                                        Vector Name
                                        <span className="text-red-500 ml-1">*</span>
                                    </Label>
                                    <Input
                                        id="vectorName"
                                        value={pageContext.current.vectorData.name}
                                        readOnly={true}
                                        className="w-full bg-white border-slate-300 text-slate-900 placeholder:text-slate-400"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="vectorEpsg" className="text-sm font-medium text-slate-900 flex items-center gap-2">
                                        <Globe className="w-4 h-4" />
                                        EPSG Code
                                        <span className="text-red-500 ml-1">*</span>
                                    </Label>
                                    <Input
                                        id="vectorEpsg"
                                        value={pageContext.current.vectorData.epsg}
                                        onChange={(e) => {
                                            pageContext.current.vectorData.epsg = e.target.value
                                            triggerRepaint()
                                        }}
                                        placeholder="e.g., EPSG:4326"
                                        className="w-full bg-white border-slate-300 text-slate-900 placeholder:text-slate-400"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="vectorColor" className="text-sm font-medium text-slate-900">
                                        Vector Color
                                    </Label>
                                    <Select
                                        value={pageContext.current.vectorData.color}
                                        onValueChange={(value: any) => {
                                            pageContext.current.vectorData.color = value
                                            applyVectorColorToDraw(getHexColorByValue(value))
                                            triggerRepaint()
                                        }}
                                    >
                                        <SelectTrigger className="w-full cursor-pointer bg-white border-slate-300 text-slate-900">
                                            <SelectValue placeholder="Select color" />
                                        </SelectTrigger>
                                        <SelectContent className="bg-white border-slate-200">
                                            {vectorColorMap.map((item) => (
                                                <SelectItem
                                                    key={item.value}
                                                    value={item.value}
                                                    className="cursor-pointer text-slate-900 hover:bg-slate-100"
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <div
                                                            className="w-4 h-4 rounded-full border border-slate-300"
                                                            style={{ backgroundColor: item.color }}
                                                        />
                                                        <span>{item.name}</span>
                                                    </div>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2 pt-4">
                                    <Label className="text-sm font-medium text-slate-900">Preview</Label>
                                    <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm text-slate-500">Type</span>
                                            <div className="flex items-center gap-2">
                                                {getVectorTypeIcon(pageContext.current.vectorData.type)}
                                                <Badge variant="secondary" className="text-xs font-semibold">
                                                    {pageContext.current.vectorData.type}
                                                </Badge>
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm text-slate-500">Name</span>
                                            <span className="text-slate-900 font-medium">{pageContext.current.vectorData.name || "Not set"}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm text-slate-500">EPSG</span>
                                            <span className="text-slate-900 font-medium">{pageContext.current.vectorData.epsg || "Not set"}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm text-slate-500">Color</span>
                                            <div
                                                className="w-20 h-6 rounded-full border-2 border-slate-300 shadow-sm"
                                                style={{
                                                    backgroundColor: vectorColorMap.find((item) => item.value === pageContext.current.vectorData.color)
                                                        ?.color,
                                                }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="text-sm w-full flex flex-row items-center justify-center px-4">
                        <Button
                            className="w-full bg-green-500 hover:bg-green-600 text-white cursor-pointer"
                            disabled={!pageContext.current.vectorData.epsg.trim()}
                            onClick={handleUpdateVector}
                        >
                            Save Changes
                        </Button>
                    </div>
                </div>
            </>
        </div>
    )
}
