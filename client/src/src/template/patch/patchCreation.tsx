import { useEffect, useReducer, useRef, useState } from 'react'
import { toast } from 'sonner'
import { SchemaData } from '../schema/types'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { IViewContext } from '@/views/IViewContext'
import { Separator } from '@/components/ui/separator'
import { Save, SquaresIntersect } from 'lucide-react'
import { MapViewContext } from '@/views/mapView/mapView'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { addMapMarker, addMapPatchBounds, clearMapMarkers, convertPointCoordinate, startDrawRectangle, stopDrawRectangle } from '@/utils/utils'
import { IResourceNode } from '../scene/iscene'

interface PatchCreationProps {
    node: IResourceNode
    context: IViewContext
}

interface PageContext {
    name: string
    schema: SchemaData | null
    originBounds: [number, number, number, number] | null       // EPSG: 4326
    adjustedBounds: [number, number, number, number] | null     // EPSG: 4326
    inputBounds: [number, number, number, number] | null        // EPSG: schema
    hasBounds: boolean
}

interface RectangleCoordinates {
    northEast: [number, number];
    southEast: [number, number];
    southWest: [number, number];
    northWest: [number, number];
    center: [number, number];
}

const patchTips = [
    { tip1: 'Fill in the name of the Schema and the EPSG code.' },
    { tip2: 'Description is optional.' },
    { tip3: 'Click the button to draw and obtain or manually fill in the coordinates of the reference point.' },
    { tip4: 'Set the grid size for each level.' },
]

export default function PatchCreation({
    node,
    context
}: PatchCreationProps) {

    const mapContext = context as MapViewContext
    const map = mapContext.map!
    const drawInstance = mapContext.drawInstance!

    const [isDrawingBounds, setIsDrawingBounds] = useState(false)
    const [generalMessage, setGeneralMessage] = useState<string | null>(null)
    const [convertCoordinate, setConvertCoordinate] = useState<[number, number, number, number] | null>(null)
    const [adjustedCoordinate, setAdjustedCoordinate] = useState<[number, number, number, number] | null>(null)
    const [formErrors, setFormErrors] = useState<{
        name: boolean
        schema: boolean
        bounds: boolean
    }>({
        name: false,
        schema: false,
        bounds: false,
    })

    const schemaMarkerPoint = useRef<[number, number]>([0, 0])
    const drawCoordinates = useRef<RectangleCoordinates | null>(null)
    const pageContext = useRef<PageContext>({
        name: '',
        schema: null,
        originBounds: null,
        adjustedBounds: null,
        inputBounds: null,
        hasBounds: false,
    })

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

    const formatSingleValue = (value: number): string => value.toFixed(6)

    const handleSetName = (e: React.ChangeEvent<HTMLInputElement>) => {
        pageContext.current.name = e.target.value
        triggerRepaint()
    }

    const handleSchemaNodeDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        e.currentTarget.classList.add('border-blue-500', 'bg-blue-50')
    }
    const handleSchemaNodeDragLeave = (e: React.DragEvent) => {
        e.currentTarget.classList.remove('border-blue-500', 'bg-blue-50')
    }
    const handleSchemaNodeDrop = (e: React.DragEvent) => {
        e.preventDefault()
        e.currentTarget.classList.remove('border-blue-500', 'bg-blue-50')
        const schemaName = e.dataTransfer.getData('text/plain')
        if (schemaName) {
            console.log('Dropped schema:', schemaName)
        }
    }

    const handleSetEPSG = (e: React.ChangeEvent<HTMLInputElement>) => {
        pageContext.current.schema!.epsg = parseInt(e.target.value)
        updateCoords()
        triggerRepaint()
    }

    const updateCoords = async () => {
        console.log('updateCoords')
    }

    const handleDrawBounds = () => {
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

    const onDrawComplete = (event: Event) => {
        const customEvent = event as CustomEvent<{ coordinates: RectangleCoordinates | null }>
        if (customEvent.detail.coordinates) {
            drawCoordinates.current = customEvent.detail.coordinates
            adjustCoords()
            addMapPatchBounds(map, [customEvent.detail.coordinates.southWest[0], customEvent.detail.coordinates.southWest[1], customEvent.detail.coordinates.northEast[0], customEvent.detail.coordinates.northEast[1]], '4326')
        }
        document.removeEventListener('rectangle-draw-complete', onDrawComplete)
        setIsDrawingBounds(false)
        stopDrawRectangle(map, drawInstance)
        triggerRepaint()
    }

    /////////////////////////////////////////////////////

    const adjustCoords = () => {
        console.log('adjustCoords')
    }

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
        const inputBounds = pageContext.current.inputBounds
        if (pageContext.current.hasBounds) {
            toast.info('Map bounds have been adjusted')
            return
        }

        if (inputBounds && inputBounds.length === 4) {
            clearMapMarkers()
            addMapMarker(map, schemaMarkerPoint.current)
            clearDrawPatchBounds()
            clearGridLines()
            const inputBoundsOn4326 = await covertBoundsTo4326(inputBounds!, pageContext.current.schema!.epsg)

            if (!inputBoundsOn4326) {
                toast.error('Failed to convert bounds to EPSG:4326')
                return
            }

            drawCoordinates.current = {
                southWest: [inputBoundsOn4326[0], inputBoundsOn4326[1]],
                southEast: [inputBoundsOn4326[2], inputBoundsOn4326[1]],
                northEast: [inputBoundsOn4326[2], inputBoundsOn4326[3]],
                northWest: [inputBoundsOn4326[0], inputBoundsOn4326[3]],
                center: [(inputBoundsOn4326[0] + inputBoundsOn4326[2]) / 2, (inputBoundsOn4326[1] + inputBoundsOn4326[3]) / 2],
            }
            adjustCoords()
            addMapPatchBounds(map, inputBoundsOn4326, '4326')
        }
    }

    const formatCoordinate = (coord: [number, number] | undefined) => {
        if (!coord) return '---'
        return `[${coord[0].toFixed(6)}, ${coord[1].toFixed(6)}]`
    }

    const handleSubmit = () => {
        console.log('handleSubmit')
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
                <div className='w-2/3 mx-auto mt-4 mb-4 space-y-4 pb-4'>
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
                                onChange={handleSetName}
                                placeholder={'Enter new patch name'}
                                className={`w-full text-black border-gray-300 ${formErrors.name ? 'border-red-500 focus:ring-red-500' : ''
                                    }`}
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
                                className='border-2 border-dashed border-gray-300 rounded-lg p-6 text-center transition-colors cursor-pointer hover:border-gray-400'
                            >
                                {pageContext.current.schema?.name ? (
                                    <div className='text-black'>
                                        <div className='font-medium'>{pageContext.current.schema.name}</div>
                                        <div className='text-sm text-gray-500 mt-1'>Drag to change</div>
                                    </div>
                                ) : (
                                    <div className='text-gray-500'>
                                        <div className='font-medium'>Drag a schema here</div>
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
                            EPSG Code
                        </h2>
                        <div className='space-y-2'>
                            <Input
                                id='epsg'
                                placeholder={'Enter EPSG code (e.g. 4326)'}
                                className={`text-black w-full border-gray-300 ${formErrors.schema ? 'border-red-500 focus:ring-red-500' : ''}`}
                                value={pageContext.current.schema?.epsg ? pageContext.current.schema.epsg.toString() : ''}
                                onChange={handleSetEPSG}
                            />
                        </div>
                    </div>
                    {/* --------- */}
                    {/* Patch Bounds */}
                    {/* --------- */}
                    <div className='bg-white rounded-lg shadow-sm p-4 border border-gray-200'>
                        <h2 className='text-lg font-semibold mb-2'>
                            Patch Bounds
                        </h2>
                        <div className='space-y-2'>
                            <div className='p-2 bg-white rounded-md shadow-sm border border-gray-200'>
                                <div className='font-bold text-md mb-2'>
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
                                <div className='mb-2 font-bold text-md'>
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
                                            className='w-full text-center border border-gray-500 rounded-sm h-[22px]'
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
                                            className='w-full text-center border border-gray-500 rounded-sm h-[22px]'
                                            placeholder='Enter min X'
                                            step='any'
                                        />
                                    </div>
                                    {/* Center */}
                                    <div className='text-center'>
                                        <span className='font-bold text-[#FF8F2E] text-xl'>Center</span>
                                        <div
                                            className='text-[10px] mt-1'
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
                                            className='w-full text-center border border-gray-500 rounded-sm h-[22px]'
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
                                            className='w-full text-center border border-gray-500 rounded-sm h-[22px]'
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
                    {convertCoordinate &&
                        <div className='mt-4 p-3 bg-white rounded-md shadow-sm border border-gray-200'>
                            <h3 className='font-semibold text-lg mb-2'>Original Bounds (EPSG:{pageContext.current.schema?.epsg ? pageContext.current.schema.epsg.toString() : ''})</h3>
                            <div className='grid grid-cols-3 gap-1 text-xs'>
                                {/* Top Left Corner */}
                                <div className='relative h-12 flex items-center justify-center'>
                                    <div className='absolute top-0 left-1/4 w-3/4 h-1/2 border-t-2 border-l-2 border-gray-300 rounded-tl'></div>
                                </div>
                                {/* North/Top - northEast[1] */}
                                <div className='text-center'>
                                    <span className='font-bold text-blue-600 text-xl'>N</span>
                                    <div>[{formatSingleValue(convertCoordinate[3])}]</div>
                                </div>
                                {/* Top Right Corner */}
                                <div className='relative h-12 flex items-center justify-center'>
                                    <div className='absolute top-0 right-1/4 w-3/4 h-1/2 border-t-2 border-r-2 border-gray-300 rounded-tr'></div>
                                </div>
                                {/* West/Left - southWest[0] */}
                                <div className='text-center'>
                                    <span className='font-bold text-green-600 text-xl'>W</span>
                                    <div>[{formatSingleValue(convertCoordinate[0])}]</div>
                                </div>
                                {/* Center */}
                                <div className='text-center'>
                                    <span className='font-bold text-xl'>Center</span>
                                    <div>{formatCoordinate([(convertCoordinate[0] + convertCoordinate[2]) / 2, (convertCoordinate[1] + convertCoordinate[3]) / 2])}</div>
                                </div>
                                {/* East/Right - southEast[0] */}
                                <div className='text-center'>
                                    <span className='font-bold text-red-600 text-xl'>E</span>
                                    <div>[{formatSingleValue(convertCoordinate[2])}]</div>
                                </div>
                                {/* Bottom Left Corner */}
                                <div className='relative h-12 flex items-center justify-center'>
                                    <div className='absolute bottom-0 left-1/4 w-3/4 h-1/2 border-b-2 border-l-2 border-gray-300 rounded-bl'></div>
                                </div>
                                {/* South/Bottom - southWest[1] */}
                                <div className='text-center'>
                                    <span className='font-bold text-purple-600 text-xl'>S</span>
                                    <div>[{formatSingleValue(convertCoordinate[1])}]</div>
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
                    {adjustedCoordinate &&
                        <div className='mt-4 p-3 bg-white rounded-md shadow-sm border border-gray-200'>
                            <h3 className='font-semibold text-lg mb-2'>Adjusted Coordinates (EPSG:{pageContext.current.schema?.epsg ? pageContext.current.schema.epsg.toString() : ''})</h3>
                            <div className='grid grid-cols-3 gap-1 text-xs'>
                                {/* Top Left Corner */}
                                <div className='relative h-12 flex items-center justify-center'>
                                    <div className='absolute top-0 left-1/4 w-3/4 h-1/2 border-t-2 border-l-2 border-gray-300 rounded-tl'></div>
                                </div>
                                {/* North/Top - northEast[1] */}
                                <div className='text-center'>
                                    <span className='font-bold text-blue-600 text-xl'>N</span>
                                    <div>[{formatSingleValue(adjustedCoordinate[3])}]</div>
                                </div>
                                {/* Top Right Corner */}
                                <div className='relative h-12 flex items-center justify-center'>
                                    <div className='absolute top-0 right-1/4 w-3/4 h-1/2 border-t-2 border-r-2 border-gray-300 rounded-tr'></div>
                                </div>
                                {/* West/Left - southWest[0] */}
                                <div className='text-center'>
                                    <span className='font-bold text-green-600 text-xl'>W</span>
                                    <div>[{formatSingleValue(adjustedCoordinate[0])}]</div>
                                </div>
                                {/* Center */}
                                <div className='text-center'>
                                    <span className='font-bold text-xl'>Center</span>
                                    <div>{formatCoordinate([(adjustedCoordinate[0] + adjustedCoordinate[2]) / 2, (adjustedCoordinate[1] + adjustedCoordinate[3]) / 2])}</div>
                                </div>
                                {/* East/Right - southEast[0] */}
                                <div className='text-center'>
                                    <span className='font-bold text-red-600 text-xl'>E</span>
                                    <div>[{formatSingleValue(adjustedCoordinate[2])}]</div>
                                </div>
                                {/* Bottom Left Corner */}
                                <div className='relative h-12 flex items-center justify-center'>
                                    <div className='absolute bottom-0 left-1/4 w-3/4 h-1/2 border-b-2 border-l-2 border-gray-300 rounded-bl'></div>
                                </div>
                                {/* South/Bottom - southWest[1] */}
                                <div className='text-center'>
                                    <span className='font-bold text-purple-600 text-xl'>S</span>
                                    <div>[{formatSingleValue(adjustedCoordinate[1])}]</div>
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
