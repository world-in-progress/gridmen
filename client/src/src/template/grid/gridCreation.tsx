import React, { useEffect, useReducer, useState } from "react"
import {
    AlertDialog,
    AlertDialogTitle,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogContent,
    AlertDialogDescription,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Fullscreen, GripVertical, MapPin, RotateCcw, SquaresUnite, Upload, X } from 'lucide-react'
import { cn } from '@/utils/utils'
import { MapViewContext } from '@/views/mapView/mapView'
import { IResourceNode } from '../scene/iscene'
import { IViewContext } from '@/views/IViewContext'
import { toast } from 'sonner'
import * as api from '../api/apis'
import { ResourceNode, ResourceTree } from '../scene/scene'
import { Checkbox } from "@/components/ui/checkbox"
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"

interface GridCreationProps {
    node: IResourceNode
    context: IViewContext
}

interface PageContext {
    name: string
    selectedPatches: PatchResourceItem[]
    patchesBounds: Record<string, [number, number, number, number]>
    selectedVectors: VectorResourceItem[]
}

type VectorAggOp = "set" | "add" | "subtract" | "max"

interface PatchResourceItem {
    key: string
    name: string
    nodeInfo?: string
    nodeLockId?: string | null
}

interface VectorResourceItem {
    key: string
    name: string
    nodeInfo?: string
    nodeLockId?: string | null
    vectorInfo?: Record<string, any>

    demEnabled: boolean
    demOp: VectorAggOp
    demValue: string

    lumEnabled: boolean
    lumValue: string
}

const operationColorMap: Record<VectorAggOp, string> = {
    set: "bg-blue-200",
    add: "bg-green-200",
    subtract: "bg-red-200",
    max: "bg-orange-200",
}

const aggOpLabels: Record<VectorAggOp, string> = {
    set: "Set",
    add: "Add",
    subtract: "Subtract",
    max: "Max",
}

const aggOpOptions: Array<{ value: VectorAggOp; label: string }> = [
    { value: "set", label: "Set" },
    { value: "add", label: "Add" },
    { value: "subtract", label: "Subtract" },
    { value: "max", label: "Max" },
]

const normalizeDemOp = (op: any): VectorAggOp => {
    if (op === "set" || op === "add" || op === "subtract" || op === "max") return op
    // Backward compatibility for older saved values
    if (op === "max") return "max"
    if (op === "min") return "max"
    return "max"
}

const vectorColorMap = [
    { value: "sky-500", color: "#0ea5e9" },
    { value: "green-500", color: "#22c55e" },
    { value: "red-500", color: "#ef4444" },
    { value: "purple-500", color: "#a855f7" },
    { value: "yellow-300", color: "#FFDF20" },
    { value: "orange-500", color: "#FF6900" },
    { value: "pink-500", color: "#ec4899" },
    { value: "indigo-500", color: "#6366f1" },
]

const getHexColorByValue = (value: string | undefined | null) => {
    if (!value) return "#0ea5e9"
    return vectorColorMap.find((item) => item.value === value)?.color ?? "#0ea5e9"
}

const djb2Hash = (input: string) => {
    let hash = 5381
    for (let i = 0; i < input.length; i++) hash = (hash * 33) ^ input.charCodeAt(i)
    return (hash >>> 0).toString(16)
}

const toSafeMapId = (raw: string) => {
    const normalized = String(raw ?? "")
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, "_")
    const suffix = djb2Hash(normalized)
    return `${normalized.slice(0, 48)}_${suffix}`
}

const toValidFeatureCollection = (fc: any, fallbackHexColor: string): GeoJSON.FeatureCollection => {
    const features = Array.isArray(fc?.features) ? fc.features : []

    const validFeatures = features
        .filter((f: any) => {
            const t = f?.geometry?.type
            if (!t) return false
            if (t === "Polygon") {
                const ring = f?.geometry?.coordinates?.[0]
                return Array.isArray(ring) && ring.length >= 4
            }
            if (t === "MultiPolygon") {
                const ring = f?.geometry?.coordinates?.[0]?.[0]
                return Array.isArray(ring) && ring.length >= 4
            }
            return true
        })
        .map((f: any) => {
            const id = f?.id ?? (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`)
            const existingColor = f?.properties?.user_color
            const hex = typeof existingColor === "string" && existingColor ? existingColor : fallbackHexColor
            return {
                ...f,
                id,
                properties: {
                    ...(f?.properties ?? {}),
                    user_color: hex,
                },
            }
        })

    return {
        type: "FeatureCollection",
        features: validFeatures,
    }
}

const gridTips = [
    { tip1: "Drag patches from the EXPLORER to the upload area." },
    { tip2: "Reset button will clear all uploaded patches." },
    { tip3: "Click merge button to complete grid creation." },
]

export default function GridCreation({ node, context }: GridCreationProps) {
    const mapContext = context as MapViewContext
    const map = mapContext.map!

    const addVectorPreviewToMap = (vectorKey: string, vectorInfo: any) => {
        if (!map) return
        const featureJson = vectorInfo?.feature_json
        if (!featureJson || featureJson?.type !== "FeatureCollection") return

        const epsg = String(vectorInfo?.epsg ?? "4326")
        if (epsg && epsg !== "4326") {
            toast.warning(`Vector EPSG=${epsg} is not supported for preview (expected 4326)`)
        }

        const safeId = toSafeMapId(vectorKey)
        const sourceId = `grid-vector-src-${safeId}`
        const fillLayerId = `grid-vector-fill-${safeId}`
        const lineLayerId = `grid-vector-line-${safeId}`
        const pointLayerId = `grid-vector-point-${safeId}`

        const hex = getHexColorByValue(String(vectorInfo?.color ?? "sky-500"))
        const data = toValidFeatureCollection(featureJson, hex)
        if (!Array.isArray(data.features) || data.features.length === 0) return

        const apply = () => {
            try {
                const src = map.getSource(sourceId) as any
                if (src?.setData) {
                    src.setData(data as any)
                } else {
                    if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId)
                    if (map.getLayer(lineLayerId)) map.removeLayer(lineLayerId)
                    if (map.getLayer(pointLayerId)) map.removeLayer(pointLayerId)
                    if (map.getSource(sourceId)) map.removeSource(sourceId)

                    map.addSource(sourceId, {
                        type: "geojson",
                        data: data as any,
                    })
                }

                if (!map.getLayer(fillLayerId)) {
                    map.addLayer({
                        id: fillLayerId,
                        type: "fill",
                        source: sourceId,
                        filter: ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "MultiPolygon"]],
                        paint: {
                            "fill-color": ["coalesce", ["get", "user_color"], hex],
                            "fill-opacity": 0.25,
                        },
                    })
                }

                if (!map.getLayer(lineLayerId)) {
                    map.addLayer({
                        id: lineLayerId,
                        type: "line",
                        source: sourceId,
                        filter: [
                            "any",
                            ["==", ["geometry-type"], "Polygon"],
                            ["==", ["geometry-type"], "MultiPolygon"],
                            ["==", ["geometry-type"], "LineString"],
                            ["==", ["geometry-type"], "MultiLineString"],
                        ],
                        paint: {
                            "line-color": ["coalesce", ["get", "user_color"], hex],
                            "line-width": 2,
                        },
                    })
                }

                if (!map.getLayer(pointLayerId)) {
                    map.addLayer({
                        id: pointLayerId,
                        type: "circle",
                        source: sourceId,
                        filter: ["any", ["==", ["geometry-type"], "Point"], ["==", ["geometry-type"], "MultiPoint"]],
                        paint: {
                            "circle-color": ["coalesce", ["get", "user_color"], hex],
                            "circle-radius": 6,
                            "circle-stroke-color": "#ffffff",
                            "circle-stroke-width": 1,
                        },
                    })
                }
            } catch (e) {
                console.warn("Failed to preview vector on map:", e)
            }
        }

        if ((map as any).isStyleLoaded?.()) {
            apply()
        } else {
            ; (map as any).once?.("style.load", apply)
        }
    }

    const removeVectorPreviewFromMap = (vectorKey: string) => {
        if (!map) return
        const safeId = toSafeMapId(vectorKey)
        const sourceId = `grid-vector-src-${safeId}`
        const fillLayerId = `grid-vector-fill-${safeId}`
        const lineLayerId = `grid-vector-line-${safeId}`
        const pointLayerId = `grid-vector-point-${safeId}`
        try {
            if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId)
            if (map.getLayer(lineLayerId)) map.removeLayer(lineLayerId)
            if (map.getLayer(pointLayerId)) map.removeLayer(pointLayerId)
            if (map.getSource(sourceId)) map.removeSource(sourceId)
        } catch (e) {
            console.warn("Failed to remove vector preview from map:", e)
        }
    }

    const pageContext = React.useRef<PageContext>({
        name: "",
        selectedPatches: [],
        patchesBounds: {},
        selectedVectors: [],
    })

    const [isDragOver, setIsDragOver] = useState(false)
    const [isVectorDragOver, setIsVectorDragOver] = useState(false)
    const [mergeDialogOpen, setMergeDialogOpen] = useState(false)
    const [highlightedResource, setHighlightedResource] = useState<string | null>(null)

    const [, triggerRepaint] = useReducer((x) => x + 1, 0)

    useEffect(() => {
        loadContext()

        return () => {
            unloadContext()
        }
    }, [])

    const loadContext = () => {
        if ((node as ResourceNode).context !== undefined) {
            pageContext.current = { ...(node as ResourceNode).context }
        } else {
            pageContext.current.name = node.name.split(".")[0]
        }

        if (!Array.isArray(pageContext.current.selectedVectors)) {
            pageContext.current.selectedVectors = []
        }

        // Backward compatibility for older saved context
        for (const item of pageContext.current.selectedVectors as any[]) {
            if (typeof item.demEnabled !== "boolean") item.demEnabled = Boolean(item.demEnabled)
            item.demOp = normalizeDemOp(item.demOp)
            if (typeof item.demValue !== "string") item.demValue = item.demValue == null ? "" : String(item.demValue)

            if (typeof item.lumEnabled !== "boolean") item.lumEnabled = Boolean(item.lumEnabled)
            if (typeof item.lumValue !== "string") item.lumValue = item.lumValue == null ? "" : String(item.lumValue)
        }

        triggerRepaint()
    }

    const unloadContext = () => {
        ; (node as ResourceNode).context = {
            ...pageContext.current,
        }

        return
    }

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragOver(true)
    }

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragOver(false)
    }

    const handlePatchDropZoneDrop = async (e: React.DragEvent) => {
        e.preventDefault()
        setIsVectorDragOver(false)

        const reorderRaw = e.dataTransfer.getData("application/gridmen-vector-reorder")
        if (reorderRaw) {
            try {
                const payload = JSON.parse(reorderRaw) as { fromIndex: number }
                if (typeof payload.fromIndex !== "number") return
                const toIndex = pageContext.current.selectedPatches.length - 1
                if (payload.fromIndex === toIndex) return

                const list = pageContext.current.selectedPatches
                const [moved] = list.splice(payload.fromIndex, 1)
                list.splice(Math.max(0, toIndex), 0, moved)
                triggerRepaint()
                return
            } catch {
                // ignore
            }
        }

        const raw = e.dataTransfer.getData("application/gridmen-node") || e.dataTransfer.getData("text/plain")
        if (!raw) return
        addPatchFromExplorerDrop(raw)
    }

    const addPatchFromExplorerDrop = (raw: string) => {
        try {
            const payload = JSON.parse(raw) as {
                nodeKey: string
                nodeInfo: string
                nodeLockId: string | null
                templateName: string
                sourceTreeTitle: string
            }

            if (!payload?.nodeKey || payload.templateName !== "patch") {
                toast.error("Please drag a patch resource")
                return
            }

            const exists = pageContext.current.selectedPatches.some((p) => p.key === payload.nodeKey)
            if (exists) {
                toast.info("This patch is already in the list")
                return
            }

            pageContext.current.selectedPatches.push({
                key: payload.nodeKey,
                name: payload.nodeKey.split(".").pop() || "Patch",
                nodeInfo: payload.nodeInfo,
                nodeLockId: payload.nodeLockId,
            })

            triggerRepaint()

        } catch {
            const nodeKey = raw
            if (!nodeKey) return
            if (!nodeKey.toLowerCase().includes("patch")) {
                toast.error("Please drag a patch resource")
                return
            }

            const exists = pageContext.current.selectedPatches.some((p) => p.key === nodeKey)
            if (exists) {
                toast.info("This patch is already in the list")
                return
            }

            pageContext.current.selectedPatches.push({
                key: nodeKey,
                name: nodeKey.split(".").pop() || "Patch",
            })

            triggerRepaint()
        }
    }

    const handleVectorDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        setIsVectorDragOver(true)
    }

    const handleVectorDragLeave = (e: React.DragEvent) => {
        e.preventDefault()
        setIsVectorDragOver(false)
    }

    const addVectorFromExplorerDrop = async (raw: string) => {
        try {
            const payload = JSON.parse(raw) as {
                nodeKey: string
                nodeInfo: string
                nodeLockId: string | null
                templateName: string
                sourceTreeTitle: string
            }

            if (!payload?.nodeKey || payload.templateName !== "vector") {
                toast.error("Please drag a vector resource")
                return
            }

            const exists = pageContext.current.selectedVectors.some((v) => v.key === payload.nodeKey)
            if (exists) {
                toast.info("This vector is already in the list")
                return
            }

            console.log("Fetching vector info for:", payload.nodeInfo, payload.nodeLockId)
            const getVectorResponse = await api.vector.getVector(payload.nodeInfo, payload.nodeLockId)
            console.log("Fetched vector info:", getVectorResponse.data)

            // Restore vector features onto the map
            addVectorPreviewToMap(payload.nodeKey, getVectorResponse.data)

            pageContext.current.selectedVectors.push({
                key: payload.nodeKey,
                name: payload.sourceTreeTitle || payload.nodeKey.split(".").pop() || "Vector",
                nodeInfo: payload.nodeInfo,
                nodeLockId: payload.nodeLockId,
                vectorInfo: getVectorResponse.data,

                demEnabled: false,
                demOp: "max",
                demValue: "",

                lumEnabled: false,
                lumValue: "",
            })

            triggerRepaint()
        } catch {
            // Fallback: only text/plain nodeKey is available (templateName unknown)
            const nodeKey = raw
            if (!nodeKey) return
            if (!nodeKey.toLowerCase().includes("vector")) {
                toast.error("Please drag a vector resource")
                return
            }

            const exists = pageContext.current.selectedVectors.some((v) => v.key === nodeKey)
            if (exists) {
                toast.info("This vector is already in the list")
                return
            }

            pageContext.current.selectedVectors.push({
                key: nodeKey,
                name: nodeKey.split(".").pop() || "Vector",

                demEnabled: false,
                demOp: "max",
                demValue: "",

                lumEnabled: false,
                lumValue: "",
            })
            triggerRepaint()
        }
    }

    const handleVectorDropZoneDrop = (e: React.DragEvent) => {
        e.preventDefault()
        setIsVectorDragOver(false)

        const reorderRaw = e.dataTransfer.getData("application/gridmen-vector-reorder")
        if (reorderRaw) {
            try {
                const payload = JSON.parse(reorderRaw) as { fromIndex: number }
                if (typeof payload.fromIndex !== "number") return
                const toIndex = pageContext.current.selectedVectors.length - 1
                if (payload.fromIndex === toIndex) return

                const list = pageContext.current.selectedVectors
                const [moved] = list.splice(payload.fromIndex, 1)
                list.splice(Math.max(0, toIndex), 0, moved)
                triggerRepaint()
                return
            } catch {
                // ignore
            }
        }

        const raw = e.dataTransfer.getData("application/gridmen-node") || e.dataTransfer.getData("text/plain")
        if (!raw) return
        addVectorFromExplorerDrop(raw)
    }

    const handleVectorItemDragStart = (index: number) => (e: React.DragEvent) => {
        e.dataTransfer.setData("application/gridmen-vector-reorder", JSON.stringify({ fromIndex: index }))
        e.dataTransfer.effectAllowed = "move"
    }

    const handleVectorItemDrop = (toIndex: number) => (e: React.DragEvent) => {
        e.preventDefault()

        const reorderRaw = e.dataTransfer.getData("application/gridmen-vector-reorder")
        if (reorderRaw) {
            try {
                const payload = JSON.parse(reorderRaw) as { fromIndex: number }
                const fromIndex = payload.fromIndex
                if (typeof fromIndex !== "number") return
                if (fromIndex === toIndex) return

                const list = pageContext.current.selectedVectors
                if (fromIndex < 0 || fromIndex >= list.length) return
                if (toIndex < 0 || toIndex >= list.length) return

                const [moved] = list.splice(fromIndex, 1)
                list.splice(toIndex, 0, moved)
                triggerRepaint()
                return
            } catch {
                // ignore
            }
        }

        // Also supports dropping a new vector directly onto an item
        const raw = e.dataTransfer.getData("application/gridmen-node") || e.dataTransfer.getData("text/plain")
        if (!raw) return
        addVectorFromExplorerDrop(raw)
    }

    const handleVectorItemDragOver = (e: React.DragEvent) => {
        e.preventDefault()
    }

    const handleVectorRemove = (index: number) => {
        const item = pageContext.current.selectedVectors[index]
        if (!item) return
        removeVectorPreviewFromMap(item.key)
        pageContext.current.selectedVectors = pageContext.current.selectedVectors.filter((_, i) => i !== index)
        triggerRepaint()
    }

    const handleVectorReset = () => {
        for (const v of pageContext.current.selectedVectors) {
            if (v?.key) removeVectorPreviewFromMap(v.key)
        }
        pageContext.current.selectedVectors = []
        triggerRepaint()
    }

    const handlePatchClick = (resourceKey: string) => {
        const patchName = resourceKey.split(".").pop()!

        setHighlightedResource(resourceKey)

        if (pageContext.current.patchesBounds[patchName]) {
            // const patchBoundsOn4326 = convertToWGS84(
            //     pageContext.current.patchesBounds[patchName],
            //     pageContext.current.schema.epsg.toString()
            // )
            // highlightPatchBounds(patchBoundsOn4326, patchName)
        }
    }

    const handlePatchRemove = (index: number) => {
        const item = pageContext.current.selectedPatches[index]
        if (!item) return
        const resourceKey = item.key
        const patchName = resourceKey.split(".").pop()!

        // clearBoundsById(patchName)

        delete pageContext.current.patchesBounds[patchName]

        pageContext.current.selectedPatches = pageContext.current.selectedPatches.filter((_, i) => i !== index)

        triggerRepaint()
    }

    const handleReset = () => {
        Object.keys(pageContext.current.patchesBounds).forEach((id) => {
            // clearBoundsById(id)
        })

        pageContext.current.selectedPatches = []
        pageContext.current.patchesBounds = {}

        for (const v of pageContext.current.selectedVectors) {
            if (v?.key) removeVectorPreviewFromMap(v.key)
        }
        pageContext.current.selectedVectors = []

        triggerRepaint()
    }

    const fitGridBounds = () => {
        if (Object.keys(pageContext.current.patchesBounds).length === 0) {
            toast.error("No patches selected")
            return
        }

        let minX = Number.POSITIVE_INFINITY
        let minY = Number.POSITIVE_INFINITY
        let maxX = Number.NEGATIVE_INFINITY
        let maxY = Number.NEGATIVE_INFINITY

        Object.values(pageContext.current.patchesBounds).forEach((bounds) => {
            minX = Math.min(minX, bounds[0])
            minY = Math.min(minY, bounds[1])
            maxX = Math.max(maxX, bounds[2])
            maxY = Math.max(maxY, bounds[3])
        })

        const bounds = [minX, minY, maxX, maxY] as [number, number, number, number]

        // const boundsOn4326 = convertToWGS84(bounds, pageContext.current.schema.epsg.toString())

        // const map = store.get<mapboxgl.Map>('map')!
        // map.fitBounds([
        //     [boundsOn4326[0], boundsOn4326[1]],
        //     [boundsOn4326[2], boundsOn4326[3]]
        // ], {
        //     padding: 80,
        //     duration: 1000
        // })
    }

    const handleMergeClick = () => {
        if (pageContext.current.name === "") {
            toast.error("Please enter a grid name")
            return
        }
        if (pageContext.current.selectedPatches.length > 0) {
            setMergeDialogOpen(true)
        }
    }

    const handleConfirmMerge = async () => {
        // const treeger_address = 'http://127.0.0.1:8000'
        // const gridInfo: GridInfo = {
        //     patches: pageContext.current.selectedResources.map((resource) => ({
        //         node_key: resource,
        //         treeger_address: treeger_address
        //     }))
        // }
        // const response = await createGrid((node as ResourceNode), pageContext.current.gridName, gridInfo)

        // store.get<{ on: Function; off: Function }>('isLoading')!.off()
        // setMergeDialogOpen(false)
        // clearDrawPatchBounds()
        // resetForm()

        toast.success("Created successfully")

        const tree = node.tree as ResourceTree
        await tree.alignNodeInfo(node, true)
        tree.notifyDomUpdate()
    }

    return (
        <div className="w-full h-full flex flex-col">
            <div className="flex-none w-full border-b border-gray-700 flex flex-col">
                {/* ------------*/}
                {/* Page Avatar */}
                {/* ------------*/}
                <div className="w-full flex justify-center items-center gap-4 p-4">
                    <Avatar className="h-10 w-10 border-2 border-white">
                        <AvatarFallback className="bg-[#007ACC]">
                            <SquaresUnite className="h-6 w-6 text-white" />
                        </AvatarFallback>
                    </Avatar>
                    <h1 className="font-bold text-[25px] relative flex items-center">
                        Create New Grid
                        <span className="bg-[#D63F26] rounded px-0.5 mb-2 text-[12px] inline-flex items-center mx-1">
                            WorkSpace
                        </span>
                    </h1>
                </div>
                {/* -----------------*/}
                {/* Page Description */}
                {/* -----------------*/}
                <div className="w-full p-4 pb-2 space-y-2 -mt-2 text-white">
                    {/* ----------*/}
                    {/* Page Tips */}
                    {/* ----------*/}
                    <div className="text-sm px-4">
                        <ul className="list-disc space-y-1">
                            {gridTips.map((tip, index) => (
                                <li key={index}>{Object.values(tip)[0]}</li>
                            ))}
                        </ul>
                    </div>
                </div>
            </div>
            <div className="flex-1 overflow-y-auto min-h-0 scrollbar-hide">
                <div className="w-full mx-auto space-y-2 px-6 pt-2 pb-4">
                    {/* ----------- */}
                    {/* Grid Name */}
                    {/* ----------- */}
                    <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
                        <h2 className="text-lg text-black font-semibold mb-2">New Grid Name</h2>
                        <div className="space-y-2">
                            <Input
                                id="name"
                                value={pageContext.current.name}
                                readOnly={true}
                                className={`w-full text-black border-gray-300`}
                            />
                        </div>
                    </div>
                    {/* ----------- */}
                    {/* Patch Drop Zone */}
                    {/* ----------- */}
                    <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
                        <h2 className="text-lg text-black font-semibold mb-2">Patch Drop Zone</h2>
                        <div>
                            <div
                                className={cn(
                                    "border-2 border-dashed rounded-lg p-4 transition-all duration-200",
                                    isDragOver
                                        ? "border-blue-400 bg-blue-50"
                                        : "border-slate-300 bg-slate-50 hover:bg-slate-100",
                                )}
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onDrop={handlePatchDropZoneDrop}
                            >
                                {pageContext.current.selectedPatches.length === 0 ? (
                                    <div className="h-[30vh] flex flex-col justify-center items-center text-slate-400">
                                        <Upload className="w-8 h-8 mb-2" />
                                        <p className="text-sm font-medium mb-1">Drag patches here</p>
                                        <p className="text-xs text-center">Drop patches from the EXPLORER</p>
                                    </div>
                                ) : (
                                    <div className="h-[30vh] overflow-y-auto scrollbar-hide pr-1">
                                        <div className="space-y-0.5">
                                            {pageContext.current.selectedPatches.map((patch, index) => {
                                                const patchKey = patch.key
                                                const patchName = patch.name || patchKey.split(".").pop() || "Patch"
                                                return (
                                                    <div
                                                        key={patchKey}
                                                        className={cn(
                                                            "bg-white border border-slate-200 rounded-lg p-3 flex flex-col gap-2 hover:shadow-sm transition-all duration-200",
                                                            highlightedResource === patchKey && "border-4 border-yellow-300",
                                                        )}
                                                    >
                                                        <div className="flex items-center justify-between">
                                                            <div className="flex-1 flex items-center gap-2 min-w-0">
                                                                <p className="text-slate-900 text-sm font-medium truncate">{patchName}</p>
                                                            </div>
                                                            <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                className="ml-2 h-6 w-6 p-0 text-sky-500 cursor-pointer"
                                                                onClick={(e) => {
                                                                    e.stopPropagation()
                                                                    handlePatchClick(patchKey)
                                                                }}
                                                            >
                                                                <MapPin className="h-3 w-3" />
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                className="ml-2 h-6 w-6 p-0 text-red-500 cursor-pointer"
                                                                onClick={(e) => {
                                                                    e.stopPropagation()
                                                                    handlePatchRemove(index)
                                                                }}
                                                            >
                                                                <X className="h-3 w-3" />
                                                            </Button>
                                                        </div>
                                                        <div className="flex items-center text-xs text-gray-500 truncate">
                                                            <span>{patchKey}</span>
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                                <span>{pageContext.current.selectedPatches.length || 0} patches uploaded</span>
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    className="bg-red-500 hover:bg-red-600 text-white hover:text-white cursor-pointer shadow-sm"
                                    onClick={handleReset}
                                    disabled={pageContext.current.selectedPatches.length === 0}
                                >
                                    <RotateCcw className="w-4 h-4" />Reset
                                </Button>
                            </div>
                        </div>
                    </div>

                    {/* ----------- */}
                    {/* Vector Drop Zone */}
                    {/* ----------- */}
                    <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
                        <h2 className="text-lg text-black font-semibold mb-2">Vector Drop Zone</h2>
                        <div>
                            <div
                                className={cn(
                                    "border-2 border-dashed rounded-lg p-4 transition-all duration-200",
                                    isVectorDragOver
                                        ? "border-purple-500 bg-purple-50"
                                        : "border-slate-300 bg-slate-50 hover:bg-slate-100",
                                )}
                                onDragOver={handleVectorDragOver}
                                onDragLeave={handleVectorDragLeave}
                                onDrop={handleVectorDropZoneDrop}
                            >
                                {pageContext.current.selectedVectors.length === 0 ? (
                                    <div className="h-[30vh] flex flex-col justify-center items-center text-slate-400">
                                        <Upload className="w-8 h-8 mb-2" />
                                        <p className="text-sm font-medium mb-1">Drag vectors here</p>
                                        <p className="text-xs text-center">Drop patches from the EXPLORER</p>
                                    </div>
                                ) : (
                                    <div className="h-[30vh] overflow-y-auto scrollbar-hide pr-1">
                                        <div className="space-y-1">
                                            {pageContext.current.selectedVectors.map((item, index) => {
                                                const showDemValue =
                                                    item.demEnabled &&
                                                    (item.demOp === "set" || item.demOp === "add" || item.demOp === "subtract")

                                                return (
                                                    <div
                                                        key={item.key}
                                                        draggable
                                                        onDragStart={handleVectorItemDragStart(index)}
                                                        onDragOver={handleVectorItemDragOver}
                                                        onDrop={handleVectorItemDrop(index)}
                                                        className={cn("bg-white border border-slate-200 rounded-lg p-2 flex flex-col gap-1 hover:shadow-sm transition-all duration-200 cursor-move")}
                                                    >
                                                        <div className="flex items-start justify-between gap-1">
                                                            <div className="flex items-center gap-2 min-w-0 flex-1">
                                                                <div className="w-8 h-8 rounded-md bg-purple-500 flex items-center justify-center flex-shrink-0 cursor-grab active:cursor-grabbing">
                                                                    <GripVertical className="h-4 w-4 text-white" />
                                                                </div>
                                                                <div className="min-w-0 flex-1">
                                                                    <p className="text-slate-900 text-sm font-medium truncate mb-0.5">{item.name}</p>
                                                                    <p className="text-xs text-slate-500 truncate font-mono bg-slate-50 px-2 py-0.5 rounded inline-block">
                                                                        {item.key}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                            <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                className="ml-2 h-6 w-6 p-0 text-red-500 cursor-pointer"
                                                                onClick={(e) => {
                                                                    e.stopPropagation()
                                                                    handleVectorRemove(index)
                                                                }}
                                                            >
                                                                <X className="h-3 w-3" />
                                                            </Button>
                                                        </div>
                                                        <div className="grid grid-cols-1 gap-0.5">
                                                            {/* DEM */}
                                                            <div className="flex items-center bg-slate-50 rounded-sm p-2 border border-slate-200">
                                                                <div className="flex items-center gap-2 min-w-0">
                                                                    <Checkbox
                                                                        className="cursor-pointer"
                                                                        checked={item.demEnabled}
                                                                        onCheckedChange={(checked) => {
                                                                            item.demEnabled = Boolean(checked)
                                                                            if (item.demEnabled && !item.demOp) item.demOp = "max"
                                                                            triggerRepaint()
                                                                        }}
                                                                    />
                                                                    <div className="flex items-center gap-1">
                                                                        <span className="text-sm text-slate-800 leading-none">DEM</span>
                                                                        <DropdownMenu>
                                                                            <DropdownMenuTrigger asChild>
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={(e) => e.stopPropagation()}
                                                                                    disabled={!item.demEnabled}
                                                                                    className={cn(
                                                                                        "cursor-pointer flex items-center",
                                                                                        !item.demEnabled && "cursor-not-allowed opacity-50",
                                                                                    )}
                                                                                >
                                                                                    <Badge
                                                                                        variant="outline"
                                                                                        className={cn(
                                                                                            "select-none font-medium",
                                                                                            operationColorMap[item.demOp],
                                                                                        )}
                                                                                    >
                                                                                        {aggOpLabels[item.demOp]}
                                                                                    </Badge>
                                                                                </button>
                                                                            </DropdownMenuTrigger>
                                                                            <DropdownMenuContent align="start">
                                                                                <DropdownMenuRadioGroup
                                                                                    value={item.demOp}
                                                                                    onValueChange={(value) => {
                                                                                        item.demOp = value as VectorAggOp
                                                                                        triggerRepaint()
                                                                                    }}
                                                                                >
                                                                                    {aggOpOptions.map((opt) => (
                                                                                        <DropdownMenuRadioItem key={opt.value} value={opt.value}>
                                                                                            {opt.label}
                                                                                        </DropdownMenuRadioItem>
                                                                                    ))}
                                                                                </DropdownMenuRadioGroup>
                                                                            </DropdownMenuContent>
                                                                        </DropdownMenu>
                                                                        <Input
                                                                            value={item.demValue}
                                                                            onClick={(e) => e.stopPropagation()}
                                                                            onChange={(e) => {
                                                                                item.demValue = e.target.value
                                                                                triggerRepaint()
                                                                            }}
                                                                            disabled={!showDemValue}
                                                                            placeholder={showDemValue ? "Enter value" : "-"}
                                                                            className="w-full h-6 rounded-sm text-base text-black border-slate-300 focus:border-purple-400"
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* LUM */}
                                                            <div className="flex items-center bg-slate-50 rounded-sm p-2 border border-slate-200">
                                                                <div className="flex items-center gap-2 min-w-0 w-full">
                                                                    <Checkbox
                                                                        className="cursor-pointer"
                                                                        checked={item.lumEnabled}
                                                                        onCheckedChange={(checked) => {
                                                                            item.lumEnabled = Boolean(checked)
                                                                            triggerRepaint()
                                                                        }}
                                                                    />
                                                                    <div className="flex items-center gap-1 min-w-0 w-full">
                                                                        <span className="text-sm text-slate-800 leading-none">LUM</span>
                                                                        <button
                                                                            type="button"
                                                                            onClick={(e) => e.stopPropagation()}
                                                                            disabled={!item.lumEnabled}
                                                                            className={cn("flex items-center", !item.lumEnabled && "cursor-not-allowed opacity-50")}
                                                                        >
                                                                            <Badge
                                                                                variant="outline"
                                                                                className={cn("select-none font-medium", operationColorMap.set)}
                                                                            >
                                                                                Set
                                                                            </Badge>
                                                                        </button>

                                                                        <Input
                                                                            value={item.lumValue}
                                                                            onClick={(e) => e.stopPropagation()}
                                                                            onChange={(e) => {
                                                                                item.lumValue = e.target.value
                                                                                triggerRepaint()
                                                                            }}
                                                                            disabled={!item.lumEnabled}
                                                                            placeholder={item.lumEnabled ? "Enter value" : "-"}
                                                                            className="w-full h-6 rounded-sm text-base text-black border-slate-300 focus:border-purple-400"
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                                <span>{pageContext.current.selectedVectors.length || 0} vectors uploaded</span>
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    className="bg-red-500 hover:bg-red-600 text-white hover:text-white cursor-pointer shadow-sm"
                                    onClick={handleVectorReset}
                                    disabled={pageContext.current.selectedVectors.length === 0}
                                >
                                    <RotateCcw className="w-4 h-4" />Reset
                                </Button>
                            </div>
                        </div>
                    </div>

                    {/* ----------- */}
                    {/* Action Buttons */}
                    {/* ----------- */}
                    <div className="flex gap-2 justify-end">
                        <Button
                            variant="default"
                            className="bg-blue-500 hover:bg-blue-600 text-white hover:text-white cursor-pointer shadow-sm"
                            onClick={fitGridBounds}
                            disabled={pageContext.current.selectedPatches.length === 0}
                        >
                            <Fullscreen className="w-4 h-4 " />
                            <span>Preview</span>
                        </Button>
                        <Button
                            type="button"
                            onClick={handleMergeClick}
                            className="bg-green-500 hover:bg-green-600 text-white cursor-pointer"
                            disabled={pageContext.current.selectedPatches.length === 0}
                        >
                            <SquaresUnite className="w-4 h-4 " />
                            Merge
                        </Button>
                    </div>
                </div>
            </div>
            <AlertDialog open={mergeDialogOpen} onOpenChange={setMergeDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Confirm Merge Patches</AlertDialogTitle>
                        <AlertDialogDescription>
                            <div className="mb-4">
                                You will merge {pageContext.current.selectedPatches.length} patches to create gird{" "}
                                <span className="font-bold">[{pageContext.current.name}]</span>
                            </div>
                            <div className="max-h-[200px] overflow-y-auto scrollbar-hide bg-gray-100 p-3 rounded-lg">
                                <ul className="list-disc list-inside space-y-1">
                                    {pageContext.current.selectedPatches.map((patch, index) => (
                                        <li key={index} className="text-sm">
                                            {(patch.name || patch.key.split(".").pop() || "Patch")} <span className="text-gray-500 text-xs">({patch.key})</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="cursor-pointer">Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleConfirmMerge} className="bg-green-600 hover:bg-green-500 cursor-pointer">
                            Confirm
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
