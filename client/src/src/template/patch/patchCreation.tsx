import { useEffect, useReducer, useRef, useState } from 'react'
import { toast } from 'sonner'
import * as api from '../noodle/apis'
import { SchemaData } from '../schema/types'
import { Input } from '@/components/ui/input'
import { ResourceNode, ResourceTree } from '../scene/scene'
import { Button } from '@/components/ui/button'
import { IResourceNode } from '../scene/iscene'
import { useLayerGroupStore } from '@/store/storeSet'
import { useToolPanelStore } from '@/store/storeSet'
import { IViewContext } from '@/views/IViewContext'
import { Separator } from '@/components/ui/separator'
import { ArrowRightLeft, MapPin, Save, SquaresIntersect, Upload, X } from 'lucide-react'
import { MapViewContext } from '@/views/mapView/mapView'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { addMapMarker, addMapPatchBounds, adjustPatchBounds, clearMapAllMarkers, clearMarkerByNodeKey, convertPointCoordinate, startDrawRectangle, stopDrawRectangle } from '@/utils/utils'
import { PatchData } from './types'

interface PatchCreationProps {
    node: IResourceNode
    context: IViewContext
}

interface Schema extends SchemaData {
    schemaNodeKey: string
}

interface PageContext {
    name: string
    schema: Schema | null
    originBounds: [number, number, number, number] | null
    convertedBounds: [number, number, number, number] | null
    adjustedBounds: [number, number, number, number] | null
    drawCoordinates: RectangleCoordinates | null
    inputBounds: [number, number, number, number] | null
    hasBounds: boolean
}

interface RectangleCoordinates {
    northEast: [number, number];
    southEast: [number, number];
    southWest: [number, number];
    northWest: [number, number];
    center: [number, number];
}

interface FormErrors {
    name: boolean
    bounds: boolean
}

interface ValidationResult {
    isValid: boolean
    errors: FormErrors
    generalError: string | null
}

const patchTips = [
    { tip1: 'Fill in the name of the Schema and the EPSG code.' },
    { tip2: 'Description is optional.' },
    { tip3: 'Click the button to draw and obtain or manually fill in the coordinates of the reference point.' },
    { tip4: 'Set the grid size for each level.' },
]

const validatePatchForm = (
    data: {
        name: string
        bounds: [number, number, number, number]
    }
): ValidationResult => {
    const errors = {
        name: false,
        description: false,
        bounds: false
    }

    let generalError: string | null = null

    // Validate name
    if (!data.name.trim()) {
        errors.name = true
        generalError = 'Please enter patch name'
        return { isValid: false, errors, generalError }
    }

    // Validate bounds
    if (!data.bounds) {
        errors.bounds = true
        generalError = 'Please draw patch bounds'
        return { isValid: false, errors, generalError }
    } else {
        if (data.bounds[0] >= data.bounds[2] || data.bounds[1] >= data.bounds[3]) {
            errors.bounds = true
            generalError = 'Please draw patch bounds correctly'
            return { isValid: false, errors, generalError }
        }
    }
    return { isValid: true, errors, generalError }
}

export default function PatchCreation({
    node,
    context
}: PatchCreationProps) {

    const mapContext = context as MapViewContext
    const map = mapContext.map!
    const drawInstance = mapContext.drawInstance!



    const pageContext = useRef<PageContext>({
        name: '',
        schema: null,
        originBounds: null,
        convertedBounds: null,
        adjustedBounds: null,
        drawCoordinates: null,
        inputBounds: null,
        hasBounds: false,
    })

    const [isDrawingBounds, setIsDrawingBounds] = useState(false)
    const [generalMessage, setGeneralMessage] = useState<string | null>(null)

    const [formErrors, setFormErrors] = useState<{
        name: boolean
        bounds: boolean
    }>({
        name: false,
        bounds: false,
    })

    const tempSchemaKeyRef = useRef<string | null>(null)

    let bgColor = 'bg-red-50'
    let textColor = 'text-red-700'
    let borderColor = 'border-red-200'
    if (generalMessage?.includes('Submitting data')) {
        bgColor = 'bg-orange-50'
        textColor = 'text-orange-700'
        borderColor = 'border-orange-200'
    }
    else if (generalMessage?.includes('Created successfully')) {
        bgColor = 'bg-green-50'
        textColor = 'text-green-700'
        borderColor = 'border-green-200'
    }

    const [, triggerRepaint] = useReducer(x => x + 1, 0)

    useEffect(() => {
        loadContext()

        return () => {
            unloadContext()
        }
    }, [])

    const loadContext = async () => {
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

    const adjustCoords = async () => {
        if (pageContext.current.originBounds && pageContext.current.originBounds.length === 4 && pageContext.current.schema) {
            const bounds = pageContext.current.originBounds
            const gridLevel = pageContext.current.schema.grid_info[0]
            const fromEPSG = 4326
            const toEPSG = pageContext.current.schema.epsg
            const alignmentOrigin = pageContext.current.schema.alignment_origin

            const { convertedBounds, alignedBounds, expandedBounds } = await adjustPatchBounds(bounds, gridLevel, fromEPSG, toEPSG, alignmentOrigin)

            pageContext.current.convertedBounds = convertedBounds
            pageContext.current.adjustedBounds = expandedBounds

            triggerRepaint()
        }
    }
    const formatSingleValue = (value: number): string => value.toFixed(6)

    const handleSchemaNodeDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        e.currentTarget.classList.add('border-blue-500', 'bg-blue-50')
    }
    const handleSchemaNodeDragLeave = (e: React.DragEvent) => {
        e.currentTarget.classList.remove('border-blue-500', 'bg-blue-50')
    }
    const handleSchemaNodeDrop = async (e: React.DragEvent) => {
        e.preventDefault()
        e.currentTarget.classList.remove('border-blue-500', 'bg-blue-50')
        const raw = e.dataTransfer.getData('application/gridmen-node') || e.dataTransfer.getData('text/plain')

        const payload = JSON.parse(raw) as {
            nodeKey: string
            templateName: string
            sourceTreeTitle: string
        }

        const { nodeKey: dragNodeKey, templateName, sourceTreeTitle } = payload

        if (!dragNodeKey || templateName !== 'schema') {
            toast.error('Please drag a schema node')
            return
        } else {
            const schemaNodeParams = await api.node.getNodeParams(dragNodeKey, sourceTreeTitle === 'Public' ? true : false)
            const { template_name, mount_params } = schemaNodeParams
            const schemaMountParams = JSON.parse(mount_params) as SchemaData
            const schema: Schema = {
                ...schemaMountParams,
                schemaNodeKey: dragNodeKey
            }

            clearMarkerByNodeKey(tempSchemaKeyRef.current!)
            const AlignmentOriginOn4326 = await convertPointCoordinate(schema.alignment_origin, schema.epsg, 4326)
            addMapMarker(map, AlignmentOriginOn4326!, schema.schemaNodeKey)
            tempSchemaKeyRef.current = schema.schemaNodeKey

            pageContext.current.schema = schema
            console.log('Dragged schema', pageContext.current.schema)
        }
        triggerRepaint()
    }

    const handleDrawBounds = () => {
        if (pageContext.current.schema === null) {
            toast.info('Please select a schema first')
            return
        }
        if (isDrawingBounds) {
            setIsDrawingBounds(false)
            stopDrawRectangle(map, drawInstance)
            document.removeEventListener('rectangle-draw-complete', onDrawComplete)
            return
        } else {
            setIsDrawingBounds(true)
            startDrawRectangle(map, drawInstance)
            document.addEventListener('rectangle-draw-complete', onDrawComplete)
        }
    }

    const onDrawComplete = async (event: Event) => {
        const customEvent = event as CustomEvent<{ coordinates: RectangleCoordinates | null }>
        if (customEvent.detail.coordinates) {
            pageContext.current.originBounds = [customEvent.detail.coordinates.southWest[0], customEvent.detail.coordinates.southWest[1], customEvent.detail.coordinates.northEast[0], customEvent.detail.coordinates.northEast[1]]
            await adjustCoords()
            pageContext.current.inputBounds = pageContext.current.convertedBounds
            addMapPatchBounds(map, [customEvent.detail.coordinates.southWest[0], customEvent.detail.coordinates.southWest[1], customEvent.detail.coordinates.northEast[0], customEvent.detail.coordinates.northEast[1]], '4326')
        }
        document.removeEventListener('rectangle-draw-complete', onDrawComplete)
        setIsDrawingBounds(false)
        stopDrawRectangle(map, drawInstance)

        triggerRepaint()
    }

    /////////////////////////////////////////////////////
    const clearDrawPatchBounds = () => {
        console.log('clearDrawPatchBounds')
    }

    const clearGridLines = () => {
        console.log('clearGridLines')
    }
    /////////////////////////////////////////////////////

    const covertBoundsTo4326 = async (bounds: [number, number, number, number], fromEPSG: number): Promise<[number, number, number, number] | null> => {
        const SW = await convertPointCoordinate([bounds[0], bounds[1]], fromEPSG, 4326)
        const NE = await convertPointCoordinate([bounds[2], bounds[3]], fromEPSG, 4326)
        if (!SW || !NE) return null
        return [SW[0], SW[1], NE[0], NE[1]]
    }

    const handleSetInputBounds = (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
        if (!pageContext.current.inputBounds) {
            pageContext.current.inputBounds = [0, 0, 0, 0]
        }
        const value = parseFloat(e.target.value) || 0
        pageContext.current.inputBounds[index] = value
        pageContext.current.hasBounds = false // reset adjusted bounds flag because input bounds have changed
        triggerRepaint()
    }

    const drawBoundsByParams = async () => {
        console.log('1')
        if (pageContext.current.hasBounds) {
            console.log('2')
            toast.info('Map bounds have been adjusted')
            return
        }

        if (pageContext.current.schema === null) {
            toast.info('Please select a schema first')
            return
        }

        if (pageContext.current.inputBounds && pageContext.current.inputBounds.length === 4 && pageContext.current.schema) {
            console.log('3')
            console.log('inputBounds', pageContext.current.inputBounds)
            clearMapAllMarkers()
            addMapMarker(map, pageContext.current.schema.alignment_origin, pageContext.current.schema.schemaNodeKey)
            clearDrawPatchBounds()
            clearGridLines()
            const inputBoundsOn4326 = await covertBoundsTo4326(pageContext.current.inputBounds!, pageContext.current.schema.epsg)

            if (!inputBoundsOn4326) {
                console.log('4')
                toast.error('Failed to convert bounds to EPSG:4326')
                return
            }

            pageContext.current.originBounds = inputBoundsOn4326

            adjustCoords()

            addMapPatchBounds(map, inputBoundsOn4326, '4326')
        }
    }

    const formatCoordinate = (coord: [number, number] | undefined) => {
        if (!coord) return '---'
        return `[${coord[0].toFixed(6)}, ${coord[1].toFixed(6)}]`
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        const validation = validatePatchForm({
            name: pageContext.current.name!,
            bounds: pageContext.current.adjustedBounds!
        })

        if (!validation.isValid) {
            setFormErrors(validation.errors)
            setGeneralMessage(validation.generalError)
            return
        }

        const patchData: PatchData = {
            name: pageContext.current.name,
            bounds: pageContext.current.adjustedBounds!,
            schema_node_key: pageContext.current.schema!.schemaNodeKey
        }

        setGeneralMessage('Submitting data...')

        try {
            await api.node.mountNode({
                node_key: node.key,
                template_name: 'patch',
                mount_params_string: JSON.stringify(patchData)
            })

            console.log('Submitting patch data:', JSON.stringify(patchData))

            // TODO: 清除Marker和Bounds
            clearMarkerByNodeKey(node.key)

            node.isTemp = false
                ; (node as ResourceNode).tree.tempNodeExist = false
                ; (node.tree as ResourceTree).selectedNode = null

            // 根据 layerGroup 模式恢复 toolPanel 状态
            const { isEditMode } = useLayerGroupStore.getState()
            useToolPanelStore.getState().setActiveTab(isEditMode ? 'edit' : 'check')

            setGeneralMessage('Created successfully')
            await (node.tree as ResourceTree).refresh()
            toast.success('Patch Created successfully')

        } catch (error) {
            setGeneralMessage(`Failed to create patch: ${error}`)
            toast.error(`Failed to create patch: ${error}`)
        }
    }

    const deleteDragSchema = () => {
        clearMarkerByNodeKey(tempSchemaKeyRef.current!)
        tempSchemaKeyRef.current = null
        pageContext.current.schema = null
        console.log('Deleted dragged schema', pageContext.current.schema)

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
                            <SquaresIntersect className='h-6 w-6 text-white' />
                        </AvatarFallback>
                    </Avatar>
                    <h1 className='font-bold text-[25px] relative flex items-center'>
                        Create New Patch
                        <span className=" bg-[#D63F26] rounded px-0.5 mb-2 text-[12px] inline-flex items-center mx-1">WorkSpace</span>
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
                            {patchTips.map((tip, index) => (
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
                    {/* Schema Name */}
                    {/* ----------- */}
                    <div className='bg-white rounded-lg shadow-sm p-4 border border-gray-200'>
                        <h2 className='text-black text-lg font-semibold mb-2'>
                            New Patch Name
                        </h2>
                        <div className='space-y-2'>
                            <Input
                                id='name'
                                value={pageContext.current.name}
                                readOnly={true}
                                className={`w-full text-black border-gray-300 ${formErrors.name ? 'border-red-500 focus:ring-red-500' : ''}`}
                            />
                        </div>
                    </div>
                    {/* --------- */}
                    {/* Belong To Schema */}
                    {/* --------- */}
                    <div className='bg-white rounded-lg shadow-sm p-4 border border-gray-200'>
                        <h2 className='text-black text-lg font-semibold mb-2'>
                            Belong To Schema
                        </h2>
                        <div className='space-y-2'>
                            <div
                                onDragOver={handleSchemaNodeDragOver}
                                onDragLeave={handleSchemaNodeDragLeave}
                                onDrop={handleSchemaNodeDrop}
                                className='border-2 border-dashed border-gray-300 rounded-lg p-4 text-center transition-all duration-200 hover:border-blue-400 hover:bg-blue-50/50 group'
                            >
                                {pageContext.current.schema?.name ? (
                                    <div className='space-y-2'>
                                        <div className='inline-flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-red-50 to-red-100 border-2 border-red-200 rounded-md shadow-md transition-all duration-200 group-hover:shadow-md group-hover:border-red-300'>
                                            <MapPin className='w-4 h-4 text-red-500' fill='none' stroke='currentColor' viewBox='0 0 24 24' />
                                            <span className='font-semibold text-black text-md'>{pageContext.current.schema.name}</span>
                                            <X className='w-4 h-4 text-gray-400 cursor-pointer hover:text-gray-600' onClick={deleteDragSchema} />
                                        </div>
                                        <div className='flex items-center justify-center gap-2 text-sm text-gray-500'>
                                            <ArrowRightLeft className='w-4 h-4' />
                                            <span >Drag to change schema</span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className='space-y-2 py-1'>
                                        <div className='inline-flex items-center justify-center w-12 h-12 bg-gray-100 rounded-full mb-2 group-hover:bg-blue-100 transition-colors'>
                                            <Upload className='w-6 h-6 text-gray-400 group-hover:text-blue-500 transition-colors' />
                                        </div>
                                        <div className='font-medium text-gray-500 text-sm'>Drag a schema here</div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                    {/* --------- */}
                    {/* EPSG Code */}
                    {/* --------- */}
                    <div className='bg-white rounded-lg shadow-sm p-4 border border-gray-200'>
                        <h2 className='text-black text-lg font-semibold mb-2'>
                            Schema EPSG Code
                        </h2>
                        <div className='space-y-2'>
                            <Input
                                id='epsg'
                                placeholder={'Get EPSG Code From Schema'}
                                className='text-black w-full border-gray-300 '
                                value={pageContext.current.schema?.epsg ? pageContext.current.schema.epsg.toString() : ''}
                                readOnly={true}
                            />
                        </div>
                    </div>
                    {/* --------- */}
                    {/* Patch Bounds */}
                    {/* --------- */}
                    <div className='bg-white rounded-lg shadow-sm p-4 border border-gray-200'>
                        <h2 className='text-black text-lg font-semibold mb-2'>
                            Patch Bounds
                        </h2>
                        <div className='space-y-2'>
                            <div className='p-2 bg-white rounded-md shadow-sm border border-gray-200'>
                                <div className='text-black font-semibold text-sm mb-2'>
                                    Method One: Draw to generate
                                </div>
                                <button
                                    type='button'
                                    onClick={handleDrawBounds}
                                    className={`w-full py-2 px-4 rounded-md font-medium transition-colors cursor-pointer ${isDrawingBounds
                                        ? 'bg-red-500 text-white hover:bg-red-600'
                                        : 'bg-blue-500 text-white hover:bg-blue-600'}`}
                                >
                                    {isDrawingBounds
                                        ? 'Click to cancel rectangle drawing'
                                        : 'Click to draw rectangle'}
                                </button>
                                {isDrawingBounds && (
                                    <div className='mt-2 p-2 bg-yellow-50 rounded-md border border-yellow-200 text-xs text-yellow-800'>
                                        <p>Drawing method:</p>
                                        <ul className='list-disc pl-4 mt-1'>
                                            <li>
                                                Click on the map to set starting point
                                            </li>
                                            <li>
                                                Move the mouse to desired location
                                            </li>
                                            <li>
                                                Click again to complete drawing
                                            </li>
                                        </ul>
                                    </div>
                                )}
                            </div>
                            <Separator className='h-px mb-2 bg-gray-300' />
                            <div className=' p-2 bg-white rounded-md shadow-sm border border-gray-200'>
                                <div className='text-black font-semibold text-sm mb-2'>
                                    Method Two: Input parameters to generate
                                </div>
                                <div className='grid grid-cols-3 mb-2 gap-1 text-xs'>
                                    {/* Top Left Corner */}
                                    <div className='relative h-12 flex items-center justify-center'>
                                        <div className='absolute top-0 left-1/4 w-3/4 h-1/2 border-t-2 border-l-2 border-gray-300 rounded-tl'></div>
                                    </div>
                                    {/* North/Top - northEast[1] */}
                                    <div className='text-center -mt-2'>
                                        <span className='font-bold text-blue-600 text-xl'>
                                            N
                                        </span>
                                        {/* Input for North */}
                                        <input
                                            type='number'
                                            value={pageContext.current.inputBounds?.[3] ?? ''}
                                            onChange={(e) => handleSetInputBounds(e, 3)}
                                            className='w-full text-center text-black border border-gray-500 rounded-sm h-[22px]'
                                            placeholder='Enter max Y'
                                            step='any'
                                        />
                                    </div>
                                    {/* Top Right Corner */}
                                    <div className='relative h-12 flex items-center justify-center'>
                                        <div className='absolute top-0 right-1/4 w-3/4 h-1/2 border-t-2 border-r-2 border-gray-300 rounded-tr'></div>
                                    </div>
                                    {/* West/Left - southWest[0] */}
                                    <div className='text-center'>
                                        <span className='font-bold text-green-600 text-xl'>
                                            W
                                        </span>
                                        {/* Input for West */}
                                        <input
                                            type='number'
                                            value={pageContext.current.inputBounds?.[0] ?? ''}
                                            onChange={(e) => handleSetInputBounds(e, 0)}
                                            className='w-full text-center text-black border border-gray-500 rounded-sm h-[22px]'
                                            placeholder='Enter min X'
                                            step='any'
                                        />
                                    </div>
                                    {/* Center */}
                                    <div className='text-center'>
                                        <span className='font-bold text-[#FF8F2E] text-xl'>Center</span>
                                        <div
                                            className='text-[10px] text-black mt-1'
                                        >
                                            {pageContext.current.inputBounds
                                                ? `${formatSingleValue(
                                                    (pageContext.current.inputBounds[0] + pageContext.current.inputBounds[2]) / 2
                                                )}, ${formatSingleValue(
                                                    (pageContext.current.inputBounds[1] + pageContext.current.inputBounds[3]) / 2
                                                )}`
                                                : 'Enter bounds'}
                                        </div>
                                    </div>
                                    {/* East/Right - southEast[0] */}
                                    <div className='text-center'>
                                        <span className='font-bold text-red-600 text-xl'>
                                            E
                                        </span>
                                        {/* Input for East */}
                                        <input
                                            type='number'
                                            value={pageContext.current.inputBounds?.[2] ?? ''}
                                            onChange={(e) => handleSetInputBounds(e, 2)}
                                            className='w-full text-center text-black border border-gray-500 rounded-sm h-[22px]'
                                            placeholder='Enter max X'
                                            step='any'
                                        />
                                    </div>
                                    {/* Bottom Left Corner */}
                                    <div className='relative h-12 flex items-center justify-center'>
                                        <div className='absolute bottom-0 left-1/4 w-3/4 h-1/2 border-b-2 border-l-2 border-gray-300 rounded-bl'></div>
                                    </div>
                                    {/* South/Bottom - southWest[1] */}
                                    <div className='text-center mt-2'>
                                        <span className='font-bold text-purple-600 text-xl'>
                                            S
                                        </span>
                                        {/* Input for South */}
                                        <input
                                            type='number'
                                            value={pageContext.current.inputBounds?.[1] ?? ''}
                                            onChange={(e) => handleSetInputBounds(e, 1)}
                                            className='w-full text-center text-black border border-gray-500 rounded-sm h-[22px]'
                                            placeholder='Enter min Y'
                                            step='any'
                                        />
                                    </div>
                                    {/* Bottom Right Corner */}
                                    <div className='relative h-12 flex items-center justify-center'>
                                        <div className='absolute bottom-0 right-1/4 w-3/4 h-1/2 border-b-2 border-r-2 border-gray-300 rounded-br'></div>
                                    </div>
                                </div>
                                <button
                                    type='button'
                                    className='w-full py-2 px-4 rounded-md font-medium transition-colors cursor-pointer bg-blue-500 text-white hover:bg-blue-600'
                                    onClick={drawBoundsByParams}
                                >
                                    Click to adjust and draw bounds
                                </button>
                            </div>
                        </div>
                    </div>
                    {/* --------------- */}
                    {/* Original Coordinates */}
                    {/* --------------- */}
                    {pageContext.current.convertedBounds &&
                        <div className='mt-4 p-3 bg-white rounded-md shadow-sm border border-gray-200'>
                            <h3 className='font-semibold text-black text-lg mb-2'>Original Bounds (EPSG:{pageContext.current.schema?.epsg ? pageContext.current.schema.epsg.toString() : ''})</h3>
                            <div className='grid grid-cols-3 gap-1 text-xs'>
                                {/* Top Left Corner */}
                                <div className='relative h-12 flex items-center justify-center'>
                                    <div className='absolute top-0 left-1/4 w-3/4 h-1/2 border-t-2 border-l-2 border-gray-300 rounded-tl'></div>
                                </div>
                                {/* North/Top - northEast[1] */}
                                <div className='text-center'>
                                    <span className='font-bold text-blue-600 text-xl'>N</span>
                                    <div className='text-black'>[{formatSingleValue(pageContext.current.convertedBounds[3])}]</div>
                                </div>
                                {/* Top Right Corner */}
                                <div className='relative h-12 flex items-center justify-center'>
                                    <div className='absolute top-0 right-1/4 w-3/4 h-1/2 border-t-2 border-r-2 border-gray-300 rounded-tr'></div>
                                </div>
                                {/* West/Left - southWest[0] */}
                                <div className='text-center'>
                                    <span className='font-bold text-green-600 text-xl'>W</span>
                                    <div className='text-black'>[{formatSingleValue(pageContext.current.convertedBounds[0])}]</div>
                                </div>
                                {/* Center */}
                                <div className='text-center'>
                                    <span className='font-bold text-[#FF8F2E] text-xl'>Center</span>
                                    <div className='text-black'>{formatCoordinate([(pageContext.current.convertedBounds[0] + pageContext.current.convertedBounds[2]) / 2, (pageContext.current.convertedBounds[1] + pageContext.current.convertedBounds[3]) / 2])}</div>
                                </div>
                                {/* East/Right - southEast[0] */}
                                <div className='text-center'>
                                    <span className='font-bold text-red-600 text-xl'>E</span>
                                    <div className='text-black'>[{formatSingleValue(pageContext.current.convertedBounds[2])}]</div>
                                </div>
                                {/* Bottom Left Corner */}
                                <div className='relative h-12 flex items-center justify-center'>
                                    <div className='absolute bottom-0 left-1/4 w-3/4 h-1/2 border-b-2 border-l-2 border-gray-300 rounded-bl'></div>
                                </div>
                                {/* South/Bottom - southWest[1] */}
                                <div className='text-center'>
                                    <span className='font-bold text-purple-600 text-xl'>S</span>
                                    <div className='text-black'>[{formatSingleValue(pageContext.current.convertedBounds[1])}]</div>
                                </div>
                                {/* Bottom Right Corner */}
                                <div className='relative h-12 flex items-center justify-center'>
                                    <div className='absolute bottom-0 right-1/4 w-3/4 h-1/2 border-b-2 border-r-2 border-gray-300 rounded-br'></div>
                                </div>
                            </div>
                        </div>
                    }
                    {/* --------------- */}
                    {/* Adjusted Coordinates */}
                    {/* --------------- */}
                    {pageContext.current.adjustedBounds &&
                        <div className='mt-4 p-3 bg-white rounded-md shadow-sm border border-gray-200'>
                            <h3 className='font-semibold text-black text-lg mb-2'>Adjusted Coordinates (EPSG:{pageContext.current.schema?.epsg ? pageContext.current.schema.epsg.toString() : ''})</h3>
                            <div className='grid grid-cols-3 gap-1 text-xs'>
                                {/* Top Left Corner */}
                                <div className='relative h-12 flex items-center justify-center'>
                                    <div className='absolute top-0 left-1/4 w-3/4 h-1/2 border-t-2 border-l-2 border-gray-300 rounded-tl'></div>
                                </div>
                                {/* North/Top - northEast[1] */}
                                <div className='text-center'>
                                    <span className='font-bold text-blue-600 text-xl'>N</span>
                                    <div className='text-black'>[{formatSingleValue(pageContext.current.adjustedBounds[3])}]</div>
                                </div>
                                {/* Top Right Corner */}
                                <div className='relative h-12 flex items-center justify-center'>
                                    <div className='absolute top-0 right-1/4 w-3/4 h-1/2 border-t-2 border-r-2 border-gray-300 rounded-tr'></div>
                                </div>
                                {/* West/Left - southWest[0] */}
                                <div className='text-center'>
                                    <span className='font-bold text-green-600 text-xl'>W</span>
                                    <div className='text-black'>[{formatSingleValue(pageContext.current.adjustedBounds[0])}]</div>
                                </div>
                                {/* Center */}
                                <div className='text-center'>
                                    <span className='font-bold text-[#FF8F2E] text-xl'>Center</span>
                                    <div className='text-black'>{formatCoordinate([(pageContext.current.adjustedBounds[0] + pageContext.current.adjustedBounds[2]) / 2, (pageContext.current.adjustedBounds[1] + pageContext.current.adjustedBounds[3]) / 2])}</div>
                                </div>
                                {/* East/Right - southEast[0] */}
                                <div className='text-center'>
                                    <span className='font-bold text-red-600 text-xl'>E</span>
                                    <div className='text-black'>[{formatSingleValue(pageContext.current.adjustedBounds[2])}]</div>
                                </div>
                                {/* Bottom Left Corner */}
                                <div className='relative h-12 flex items-center justify-center'>
                                    <div className='absolute bottom-0 left-1/4 w-3/4 h-1/2 border-b-2 border-l-2 border-gray-300 rounded-bl'></div>
                                </div>
                                {/* South/Bottom - southWest[1] */}
                                <div className='text-center'>
                                    <span className='font-bold text-purple-600 text-xl'>S</span>
                                    <div className='text-black'>[{formatSingleValue(pageContext.current.adjustedBounds[1])}]</div>
                                </div>
                                {/* Bottom Right Corner */}
                                <div className='relative h-12 flex items-center justify-center'>
                                    <div className='absolute bottom-0 right-1/4 w-3/4 h-1/2 border-b-2 border-r-2 border-gray-300 rounded-br'></div>
                                </div>
                            </div>
                        </div>
                    }
                    {/* --------------- */}
                    {/* General Message */}
                    {/* --------------- */}
                    {generalMessage &&
                        <div
                            className={`p-2 ${bgColor} ${textColor} text-sm rounded-md border ${borderColor}`}
                        >
                            {generalMessage}
                        </div>
                    }
                    {/* ------ */}
                    {/* Submit */}
                    {/* ------ */}
                    <div className='mt-4'>
                        <Button
                            type='button'
                            onClick={handleSubmit}
                            className='w-full bg-green-600 hover:bg-green-700 text-white cursor-pointer'
                        >
                            <Save className='h-4 w-4 mr-2' />
                            Create and Back
                        </Button>
                    </div>
                </div>
            </div>
        </div >
    )
}
