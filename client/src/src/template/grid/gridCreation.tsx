import React, { useCallback, useEffect, useReducer, useRef, useState } from "react"
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
import { addMapPatchBounds, clearMapPatchBounds, cn, convertBoundsCoordinates, getHexColorByValue, toValidFeatureCollection, vectorColorMap } from '@/utils/utils'
import { MapViewContext } from '@/views/mapView/mapView'
import { IResourceNode } from '../scene/iscene'
import { IViewContext } from '@/views/IViewContext'
import { toast } from 'sonner'
import * as api from '../api/apis'
import { ResourceNode, ResourceTree } from '../scene/scene'
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useLayerGroupStore, useToolPanelStore } from "@/store/storeSet"

interface GridCreationProps {
    node: IResourceNode
    context: IViewContext
}

type VectorOps = "set" | "add" | "subtract" | "max"

interface PatchMapInfo {
    nodeInfo: string
    bounds: [number, number, number, number]
}

interface SelectedVectorItem {
    nodeInfo: string
    vectorInfo: Record<string, any>

    demEnabled: boolean
    demType: VectorOps
    demValue: string

    lumEnabled: boolean
    lumValue: string
}

interface PageContext {
    name: string
    demFilePath: string
    lumFilePath: string
    patchMap: Map<string, PatchMapInfo[]>
    selectedVectors: SelectedVectorItem[]
}

const gridTips = [
    { tip1: "Drag patches from the EXPLORER to the upload area." },
    { tip2: "Reset button will clear all uploaded patches." },
    { tip3: "Click merge button to complete grid creation." },
]

export default function GridCreation({ node, context }: GridCreationProps) {
    const mapContext = context as MapViewContext
    const map = mapContext.map!

    const pageContext = React.useRef<PageContext>({
        name: "",
        demFilePath: "",
        lumFilePath: "",
        patchMap: new Map<string, PatchMapInfo[]>(),
        selectedVectors: [],
    })

    const [isDragOver, setIsDragOver] = useState(false)
    const [isVectorDragOver, setIsVectorDragOver] = useState(false)
    const [assemblyDialogOpen, setAssemblyDialogOpen] = useState(false)
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

        triggerRepaint()
    }

    const unloadContext = () => {
        return
    }

    const handleSelectDemFile = () => {

    }

    const handleClearDemFile = () => {

    }

    const handleSelectLumFile = () => {

    }

    const handleClearLumFile = () => {

    }

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault()
        setIsDragOver(true)
    }

    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault()
        setIsDragOver(false)
    }

    const handlePatchDropZoneDrop = () => {

    }

    const handleVectorDropZoneDrop = () => {

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
                    <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
                        <h2 className="text-lg text-black font-semibold">Raster Resource Upload</h2>
                        <div className="space-y-1 flex flex-col">
                            {/* DEM */}
                            <div className="flex flex-col p-2 space-y-0.5">
                                <div className="text-black font-semibold">DEM File</div>
                                <div className="flex items-center gap-2">
                                    <div className="min-w-0">
                                        <Input
                                            value={pageContext.current.demFilePath}
                                            readOnly={true}
                                            placeholder="Select DEM file"
                                            className="h-8 w-full min-w-0 rounded-sm text-base text-black border-slate-300"
                                        />
                                    </div>
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        className="cursor-pointer gap-1 shrink-0"
                                        onClick={handleSelectDemFile}
                                    >
                                        <Upload className="w-4 h-4" />
                                        Upload
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="cursor-pointer text-red-500 shrink-0"
                                        onClick={handleClearDemFile}
                                        disabled={!pageContext.current.demFilePath}
                                    >
                                        <X className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>
                            <Separator className="bg-slate-200 w-full" />
                            {/* LUM */}
                            <div className="flex flex-col p-2 space-y-0.5">
                                <div className="text-black font-semibold">LUM File</div>
                                <div className="flex items-center gap-2">
                                    <div className="min-w-0">
                                        <Input
                                            value={pageContext.current.lumFilePath}
                                            readOnly={true}
                                            placeholder="Select LUM file"
                                            className="h-8 w-full min-w-0 rounded-sm text-base text-black border-slate-300"
                                        />
                                    </div>
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        className="cursor-pointer gap-1 shrink-0"
                                        onClick={handleSelectLumFile}
                                    >
                                        <Upload className="w-4 h-4" />
                                        Upload
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="cursor-pointer text-red-500 shrink-0"
                                        onClick={handleClearLumFile}
                                        disabled={!pageContext.current.lumFilePath}
                                    >
                                        <X className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>
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
                                        <p className="text-md font-semibold text-center">With same schema</p>
                                    </div>
                                ) : (
                                    <div className="h-[30vh] overflow-y-auto scrollbar-hide pr-1">
                                        <div className="space-y-1">
                                            {pageContext.current.selectedPatches.map((patch, index) => {
                                                const patchKey = patch.nodeInfo
                                                const patchName = patchKey.split(".").pop() || "Patch"
                                                const borderClass = pickSchemaBorderClass(patch.schemaNodeKey)
                                                return (
                                                    <div
                                                        key={patchKey}
                                                        className={cn(
                                                            "bg-white rounded-lg p-3 flex flex-col gap-2 hover:shadow-sm transition-all duration-200",
                                                            `border-2 ${borderClass}`,
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
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
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
                                                        key={item.nodeInfo}
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
                                                                    <p className="text-slate-900 text-sm font-medium truncate mb-0.5">{item.nodeInfo.split(".").pop()}</p>
                                                                    <p className="text-xs text-slate-500 truncate font-mono bg-slate-50 px-2 py-0.5 rounded inline-block">
                                                                        {item.nodeInfo}
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
                            onClick={handleAssemblyClick}
                            className="bg-green-500 hover:bg-green-600 text-white cursor-pointer"
                            disabled={pageContext.current.selectedPatches.length === 0}
                        >
                            <SquaresUnite className="w-4 h-4 " />
                            Assembly
                        </Button>
                    </div>
                </div>
            </div>
            <AlertDialog open={assemblyDialogOpen} onOpenChange={setAssemblyDialogOpen}>
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
                                            {(patch.nodeInfo.split(".").pop() || "Patch")} <span className="text-gray-500 text-xs">({patch.nodeInfo})</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="cursor-pointer">Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleConfirmAssembly} className="bg-green-600 hover:bg-green-500 cursor-pointer">
                            Confirm
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
