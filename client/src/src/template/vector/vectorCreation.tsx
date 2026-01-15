import {
    LucidePointer as SplinePointer,
    Pencil,
    Save,
    Move,
    Trash2,
    Hand,
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
    Dialog,
    DialogTitle,
    DialogHeader,
    DialogFooter,
    DialogContent,
    DialogDescription,
} from "@/components/ui/dialog"
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Button } from "@/components/ui/button"
import { useEffect, useReducer, useRef, useState } from "react"
import { ResourceNode } from "../scene/scene"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

interface VectorCreationProps {
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

interface VectorData {
    type: "point" | "line" | "polygon"
    name: string
    epsg: string
    color: string
}

type ToolType = "select" | "draw" | "move" | "delete";

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

export default function VectorCreation({ node, context }: VectorCreationProps) {

    const pageContext = useRef<PageContext>({
        hasVector: false,
        drawVector: null,
        vectorData: {
            type: "point",
            name: "",
            epsg: "",
            color: "red",
        }
    })

    const [createDialogOpen, setCreateDialogOpen] = useState(false)
    const [resetDialogOpen, setResetDialogOpen] = useState(false)
    const [selectedTool, setSelectedTool] = useState<ToolType>("select");

    const [typeSelectDialogOpen, setTypeSelectDialogOpen] = useState(true)
    const [pendingType, setPendingType] = useState<VectorData["type"]>("point")

    const [, triggerRepaint] = useReducer(x => x + 1, 0)

    const vectorData = useRef<VectorData>({
        type: "point",
        name: "",
        epsg: "",
        color: "sky-500",
    })

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

    useEffect(() => {
        loadContext()
        return () => {
            unloadContext()
        }
    }, [])

    const loadContext = async () => {
        setPendingType(vectorData.current.type)
        setTypeSelectDialogOpen(true)
        // pageContext.current = await node.getPageContext() as VectorsPageContext
        // const pc = pageContext.current
        // if (pc.hasVector) {
        //     setVectorData(pc.vectorData)

        //     const vectorColor = vectorColorMap.find(item => item.value === pc.vectorData.color)?.color
        //     setVectorColor(vectorColor!)

        //     setTimeout(() => {
        //         if (pc.drawVector && pc.drawVector.vectors && pc.drawVector.vectors.length > 0) {
        //             const drawInstance = store.get<MapboxDraw>("mapDraw")
        //             if (drawInstance) {
        //                 const validVectors = {
        //                     type: "FeatureCollection" as const,
        //                     vectors: pc.drawVector.vectors.filter(vector => {
        //                         if (vector.geometry.type === "Polygon") {
        //                             return vector.geometry.coordinates[0].length >= 4;
        //                         }
        //                         return true;
        //                     })
        //                 };

        //                 try {
        //                     drawInstance.add(validVectors)
        //                 } catch (error) {
        //                     console.error("Failed to add vector:", error);
        //                 }
        //             }
        //         }
        //     }, 500);

        //     setSelectedTool("select")
        // } else {
        //     setCreateDialogOpen(true)
        //     setSelectedTool("select")
        // }
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

    const handleCreateVector = async () => {
        if (!pageContext.current!.vectorData.name.trim() || !pageContext.current!.vectorData.epsg) return

        const newVector: VectorData = {
            name: pageContext.current!.vectorData.name,
            type: pageContext.current!.vectorData.type,
            color: pageContext.current!.vectorData.color,
            epsg: pageContext.current!.vectorData.epsg,
        }

        const vectorColor = vectorColorMap.find(item => item.value === newVector.color)?.color

        // setVectorData(newVector)
        // setVectorColor(vectorColor!)
        // pageContext.current!.hasVector = true
        // pageContext.current!.vectorData = newVector
        // const createVectorRes = await apis.vector.createVector.fetch(newVector, node.tree.isPublic)
        // if (!createVectorRes.success) {
        //     toast.error(`Failed to create vector ${newVector.name}`)
        //     return
        // } else {
        //     const tree = node.tree as SceneTree
        //     await tree.alignNodeInfo(node, true)
        //     tree.notifyDomUpdate()
        //     toast.success(`Vector ${newVector.name} created successfully`)
        // }
        // setCreateDialogOpen(false)
        triggerRepaint()
    }

    const handleReselectVectorType = () => {
        // const pc = pageContext.current!
        // const drawInstance = store.get<MapboxDraw>("mapDraw")
        // if (drawInstance) {
        //     drawInstance.deleteAll()
        // }
        // pc.hasVector = false
        // pc.vectorData = {
        //     type: "point",
        //     name: "",
        //     epsg: "",
        //     color: "sky-500"
        // }
        // setResetDialogOpen(false)
        // setCreateDialogOpen(true)
        // setSelectedTool("select")
        triggerRepaint()
    }

    const handleConfirmType = () => {
        vectorData.current.type = pendingType
        setTypeSelectDialogOpen(false)
        triggerRepaint()
    }

    return (
        <div className="w-full h-full bg-slate-900 overflow-y-auto scrollbar-hide">
            <Dialog open={typeSelectDialogOpen} onOpenChange={setTypeSelectDialogOpen}>
                <DialogContent
                    className="bg-white text-slate-900 border border-slate-200"
                    onInteractOutside={(e) => e.preventDefault()}
                    onEscapeKeyDown={(e) => e.preventDefault()}
                >
                    <DialogHeader>
                        <DialogTitle className="text-slate-900">Choose vector type</DialogTitle>
                        <DialogDescription className="text-slate-600">
                            You’ll enter the editor after confirming.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-2">
                        <Label className="text-sm font-medium text-slate-900">Vector Type</Label>
                        <RadioGroup
                            value={pendingType}
                            onValueChange={(value: any) => setPendingType(value)}
                            className="space-y-0.5"
                        >
                            <div className="flex items-center space-x-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
                                <RadioGroupItem value="point" id="type-point" className="cursor-pointer" />
                                <Label htmlFor="type-point" className="flex items-center gap-2 cursor-pointer text-slate-900 flex-1">
                                    <Dot className="w-6 h-6 text-blue-500" />
                                    Point
                                </Label>
                            </div>
                            <div className="flex items-center space-x-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
                                <RadioGroupItem value="line" id="type-line" className="cursor-pointer" />
                                <Label htmlFor="type-line" className="flex items-center gap-2 cursor-pointer text-slate-900 flex-1">
                                    <Minus className="w-6 h-6 text-green-500" />
                                    Line
                                </Label>
                            </div>
                            <div className="flex items-center space-x-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
                                <RadioGroupItem value="polygon" id="type-polygon" className="cursor-pointer" />
                                <Label htmlFor="type-polygon" className="flex items-center gap-2 cursor-pointer text-slate-900 flex-1">
                                    <Square className="w-6 h-6 text-purple-500" />
                                    Polygon
                                </Label>
                            </div>
                        </RadioGroup>
                    </div>
                    <DialogFooter>
                        <Button className="bg-blue-500 hover:bg-blue-600 text-white cursor-pointer" onClick={handleConfirmType}>
                            Confirm
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {typeSelectDialogOpen ? null : (
                <div className="w-full max-w-md mx-auto">
                    <div className="border-b border-gray-700">
                        <div className="w-full flex justify-center items-center gap-4 p-4">
                            <Avatar className="h-10 w-10 border-2 border-white">
                                <AvatarFallback className="bg-[#007ACC]">
                                    <SplinePointer className="h-6 w-6 text-white" />
                                </AvatarFallback>
                            </Avatar>
                            <h1 className="font-bold text-[25px] relative flex items-center text-white">
                                Create New Vector
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
                            <div className="text-sm w-full flex flex-row items-center justify-center space-x-2">
                                <Button
                                    className="w-[1/3] bg-sky-500 hover:bg-sky-600 text-white cursor-pointer"
                                    onClick={handleReselectVectorType}
                                >
                                    Reselect Vector Type
                                </Button>
                                <Button
                                    className="w-[1/3] bg-green-500 hover:bg-green-600 text-white cursor-pointer"
                                    disabled={!vectorData.current.name.trim() || !vectorData.current.epsg.trim()}
                                    onClick={handleCreateVector}
                                >
                                    Create New Vector
                                </Button>
                            </div>
                        </div>

                        <div className="w-full p-4 space-y-4 border-t border-gray-700">
                            <div>
                                <h3 className="text-white font-semibold mb-2">Drawing Mode</h3>
                                <div className="grid grid-cols-2 gap-2">
                                    <button className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-all cursor-pointer">
                                        <Pencil className="h-4 w-4" />
                                        <span>Draw</span>
                                        <span className="text-xs opacity-80">[ Ctrl+D ]</span>
                                    </button>
                                    <button className="bg-slate-700/50 hover:bg-slate-600/50 border border-slate-600 text-white px-4 py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-all cursor-pointer">
                                        <MousePointer className="h-4 w-4" />
                                        <span>Select</span>
                                        <span className="text-xs opacity-80">[ Ctrl+S ]</span>
                                    </button>
                                    <button className="bg-slate-700/50 hover:bg-slate-600/50 border border-slate-600 text-white px-4 py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-all cursor-pointer">
                                        <Move className="h-4 w-4" />
                                        <span>Move</span>
                                        <span className="text-xs opacity-80">[ Ctrl+M ]</span>
                                    </button>
                                    <button className="bg-slate-700/50 hover:bg-slate-600/50 border border-slate-600 text-white px-4 py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-all cursor-pointer">
                                        <Hand className="h-4 w-4" />
                                        <span>Pan</span>
                                        <span className="text-xs opacity-80">[ Ctrl+H ]</span>
                                    </button>
                                </div>
                            </div>

                            <div>
                                <h3 className="text-white font-semibold mb-2">Operations</h3>
                                <div className="grid grid-cols-2 gap-2">
                                    <button className="bg-slate-700/50 hover:bg-slate-600/50 border border-slate-600 text-white px-4 py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-all cursor-pointer">
                                        <Undo2 className="h-4 w-4" />
                                        <span>Undo</span>
                                        <span className="text-xs opacity-80">[ Ctrl+Z ]</span>
                                    </button>
                                    <button className="bg-slate-700/50 hover:bg-slate-600/50 border border-slate-600 text-white px-4 py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-all cursor-pointer">
                                        <Redo2 className="h-4 w-4" />
                                        <span>Redo</span>
                                        <span className="text-xs opacity-80">[ Ctrl+Y ]</span>
                                    </button>
                                    <button className="bg-red-500 hover:bg-red-600 text-white px-4 py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-all cursor-pointer">
                                        <Trash2 className="h-4 w-4" />
                                        <span>Delete</span>
                                        <span className="text-xs opacity-80">[ Del ]</span>
                                    </button>
                                    <button className="bg-green-500 hover:bg-green-600 text-white px-4 py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-all cursor-pointer">
                                        <Save className="h-4 w-4" />
                                        <span>Save</span>
                                        <span className="text-xs opacity-80">[ Ctrl+S ]</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="p-4 space-y-4">
                        <div className="space-y-2">
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
                                        value={vectorData.current.name}
                                        onChange={(e) => {
                                            vectorData.current.name = e.target.value
                                            triggerRepaint()
                                        }}
                                        placeholder="Enter vector name"
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
                                        value={vectorData.current.epsg}
                                        onChange={(e) => {
                                            vectorData.current.epsg = e.target.value
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
                                        value={vectorData.current.color}
                                        onValueChange={(value: any) => {
                                            vectorData.current.color = value
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
                                                {getVectorTypeIcon(vectorData.current.type)}
                                                <Badge variant="secondary" className="text-xs font-semibold">
                                                    {vectorData.current.type}
                                                </Badge>
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm text-slate-500">Name</span>
                                            <span className="text-slate-900 font-medium">{vectorData.current.name || "Not set"}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm text-slate-500">EPSG</span>
                                            <span className="text-slate-900 font-medium">{vectorData.current.epsg || "Not set"}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm text-slate-500">Color</span>
                                            <div
                                                className="w-20 h-6 rounded-full border-2 border-slate-300 shadow-sm"
                                                style={{
                                                    backgroundColor: vectorColorMap.find((item) => item.value === vectorData.current.color)
                                                        ?.color,
                                                }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
