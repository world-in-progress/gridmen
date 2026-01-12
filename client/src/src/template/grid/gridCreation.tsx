import React, { useEffect, useReducer, useState } from 'react'
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
import { Fullscreen, MapPin, RotateCcw, SquaresUnite, Upload, X } from 'lucide-react'
import { cn } from '@/utils/utils'
import { MapViewContext } from '@/views/mapView/mapView'
import { IResourceNode } from '../scene/iscene'
import { IViewContext } from '@/views/IViewContext'
import { toast } from 'sonner'
import * as apis from '@/template/noodle/apis'
import { GridInfo } from '@/core/grid/NHGridManager'
import { ResourceNode, ResourceTree } from '../scene/scene'

interface GridCreationProps {
    node: IResourceNode
    context: IViewContext
}

interface PageContext {
    name: string
    selectedPatches: string[]
    patchesBounds: Record<string, [number, number, number, number]>
}

const gridTips = [
    { tip1: 'Drag patches from the EXPLORER to the upload area.' },
    { tip2: 'Reset button will clear all uploaded patches.' },
    { tip3: 'Click merge button to complete grid creation.' },
]

export default function GridCreation({
    node,
    context
}: GridCreationProps) {
    const mapContext = context as MapViewContext
    const map = mapContext.map!

    const pageContext = React.useRef<PageContext>({
        name: '',
        selectedPatches: [],
        patchesBounds: {}
    })

    const [isDragOver, setIsDragOver] = useState(false)
    const [mergeDialogOpen, setMergeDialogOpen] = useState(false)
    const [highlightedResource, setHighlightedResource] = useState<string | null>(null)

    const [, triggerRepaint] = useReducer(x => x + 1, 0)

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
            pageContext.current.name = node.name.split('.')[0]
        }

        triggerRepaint()
    }

    const unloadContext = () => {
        (node as ResourceNode).context = {
            ...pageContext.current
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

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragOver(false)

        const nodeKey = e.dataTransfer.getData('text/plain')
        const patchPath = nodeKey.split('.').slice(0, -2).join('.')
        const patchName = nodeKey.split('.').pop()
        const schemaPath = node.key.split('.').slice(0, -1).join('.')
        if (schemaPath === patchPath) {
            if (nodeKey.split('.').slice(-2)[0] === 'patches') {
                // const isAlreadySelected = pageContext.current.selectedResources.some((resource) => resource === nodeKey)
                // if (!isAlreadySelected) {
                //     pageContext.current.selectedResources.push(nodeKey)
                //     const res = await apis.patch.getPatchMeta.fetch({ schemaName: pageContext.current.schema.name, patchName: patchName! }, node.tree.isPublic)
                //     if (res && res.bounds) {
                //         const boundsId = patchName!
                //         pageContext.current.patchesBounds[boundsId] = res.bounds

                //         const patchBoundsOn4326 = convertToWGS84(res.bounds, pageContext.current.schema.epsg.toString())
                //         addMapPatchBounds(patchBoundsOn4326, boundsId)
                //     }
                //     triggerRepaint()
                // }
            } else {
                toast.error(`Please select patch not grid`)
            }
        } else {
            // toast.error(`Please select the correct patch on schema [${pageContext.current.schema.name}]`)
        }
    }

    const handlePatchClick = (resourceKey: string) => {
        const patchName = resourceKey.split('.').pop()!;

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
        const resourceKey = pageContext.current.selectedPatches[index]
        const patchName = resourceKey.split('.').pop()!

        // clearBoundsById(patchName)

        delete pageContext.current.patchesBounds[patchName]

        pageContext.current.selectedPatches = pageContext.current.selectedPatches.filter((_, i) => i !== index)

        triggerRepaint()
    }

    const handleReset = () => {
        Object.keys(pageContext.current.patchesBounds).forEach(id => {
            // clearBoundsById(id)
        })

        pageContext.current.selectedPatches = []
        pageContext.current.patchesBounds = {}

        triggerRepaint()
    }

    const fitGridBounds = () => {
        if (Object.keys(pageContext.current.patchesBounds).length === 0) {
            toast.error('No patches selected')
            return
        }

        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity

        Object.values(pageContext.current.patchesBounds).forEach(bounds => {
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
        if (pageContext.current.name === '') {
            toast.error('Please enter a grid name')
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

        toast.success('Created successfully')

        const tree = node.tree as ResourceTree
        await tree.alignNodeInfo(node, true)
        tree.notifyDomUpdate()
    }

    const resetForm = () => {
        pageContext.current.name = ''
        pageContext.current.selectedPatches = []
        triggerRepaint()
    }

    return (
        <div className='w-full h-full flex flex-col'>
            <div className='flex-none w-full border-b border-gray-700 flex flex-col'>
                {/* ------------*/}
                {/* Page Avatar */}
                {/* ------------*/}
                <div className='w-full flex justify-center items-center gap-4 p-4'>
                    <Avatar className='h-10 w-10 border-2 border-white'>
                        <AvatarFallback className='bg-[#007ACC]'>
                            <SquaresUnite className='h-6 w-6 text-white' />
                        </AvatarFallback>
                    </Avatar>
                    <h1 className='font-bold text-[25px] relative flex items-center'>
                        Create New Grid
                        <span className='bg-[#D63F26] rounded px-0.5 mb-2 text-[12px] inline-flex items-center mx-1'>WorkSpace</span>
                    </h1>
                </div>
                {/* -----------------*/}
                {/* Page Description */}
                {/* -----------------*/}
                <div className='w-full p-4 pb-2 space-y-2 -mt-2 text-white'>
                    {/* ----------*/}
                    {/* Page Tips */}
                    {/* ----------*/}
                    <div className='text-sm px-4'>
                        <ul className='list-disc space-y-1'>
                            {gridTips.map((tip, index) => (
                                <li key={index}>
                                    {Object.values(tip)[0]}
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            </div>
            <div className='flex-1 overflow-y-auto min-h-0 scrollbar-hide'>
                <div className='w-full mx-auto space-y-2 px-6 pt-2 pb-4'>
                    {/* ----------- */}
                    {/* Grid Name */}
                    {/* ----------- */}
                    <div className='bg-white rounded-lg shadow-sm p-4 border border-gray-200'>
                        <h2 className='text-lg text-black font-semibold mb-2'>
                            New Grid Name
                        </h2>
                        <div className='space-y-2'>
                            <Input
                                id='name'
                                value={pageContext.current.name}
                                readOnly={true}
                                className={`w-full text-black border-gray-300`}
                            />
                        </div>
                    </div>
                    {/* ----------- */}
                    {/* Patch Drop Zone */}
                    {/* ----------- */}
                    <div className='bg-white rounded-lg shadow-sm p-4 border border-gray-200 mb-4'>
                        <h2 className='text-lg text-black font-semibold mb-2'>
                            Patch Drop Zone
                        </h2>
                        <div>
                            <div
                                className={cn(
                                    "border-2 border-dashed rounded-lg p-4 transition-all duration-200",
                                    isDragOver ? "border-blue-400 bg-blue-50" : "border-slate-300 bg-slate-50 hover:bg-slate-100",
                                )}
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onDrop={handleDrop}
                            >
                                {pageContext.current.selectedPatches.length === 0 ? (
                                    <div className="h-[32vh] flex flex-col justify-center items-center text-slate-400">
                                        <Upload className="w-8 h-8 mb-2" />
                                        <p className="text-sm font-medium mb-1">Drag patches here</p>
                                        <p className="text-xs text-center">Drop files from the resource manager</p>
                                    </div>
                                ) : (
                                    <div className="h-[32vh] overflow-y-auto pr-1">
                                        <div className="space-y-2">
                                            {pageContext.current.selectedPatches.map((patch, index) => {
                                                const patchName = patch.split('.').pop();
                                                return (
                                                    <div
                                                        key={patch}
                                                        className={cn(
                                                            "bg-white border border-slate-200 rounded-lg p-3 flex flex-col gap-2 hover:shadow-sm transition-all duration-200",
                                                            highlightedResource === patch && "border-4 border-yellow-300"
                                                        )}
                                                    >
                                                        <div className="flex items-center justify-between">
                                                            <div className="flex-1 flex items-center gap-2 min-w-0">
                                                                <p className="text-slate-900 text-sm font-medium truncate">
                                                                    {patchName}
                                                                </p>
                                                            </div>
                                                            <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                className="ml-2 h-6 w-6 p-0 hover:text-sky-500 cursor-pointer"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handlePatchClick(patch)
                                                                }}
                                                            >
                                                                <MapPin className="h-3 w-3" />
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                className="ml-2 h-6 w-6 p-0 hover:text-red-500 cursor-pointer"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handlePatchRemove(index);
                                                                }}
                                                            >
                                                                <X className="h-3 w-3" />
                                                            </Button>
                                                        </div>
                                                        <div className="flex items-center text-xs text-gray-500 truncate">
                                                            <span>{patch}</span>
                                                        </div>
                                                    </div>
                                                );
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
                                    <RotateCcw className="w-4 h-4 " />
                                    <span>Reset</span>
                                </Button>
                            </div>
                        </div>
                    </div>
                    <div className='flex gap-2 justify-end'>
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
                            type='button'
                            onClick={handleMergeClick}
                            className='bg-green-500 hover:bg-green-600 text-white cursor-pointer'
                            disabled={pageContext.current.selectedPatches.length === 0}
                        >
                            <SquaresUnite className='w-4 h-4 ' />
                            Merge
                        </Button>
                    </div>
                </div>
            </div>
            <AlertDialog
                open={mergeDialogOpen}
                onOpenChange={setMergeDialogOpen}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Confirm Merge Patches
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            <div className='mb-4'>
                                You will merge {pageContext.current.selectedPatches.length} patches to create gird <span className='font-bold'>[{pageContext.current.name}]</span>
                            </div>
                            <div className='max-h-[200px] overflow-y-auto bg-gray-100 p-3 rounded-lg'>
                                <ul className='list-disc list-inside space-y-1'>
                                    {pageContext.current.selectedPatches.map((patch, index) => (
                                        <li key={index} className='text-sm'>
                                            {patch.split('.').pop()} <span className='text-gray-500 text-xs'>({patch})</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className='cursor-pointer'>
                            Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleConfirmMerge}
                            className='bg-green-600 hover:bg-green-500 cursor-pointer'
                        >
                            Confirm
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
