import { useReducer, useRef, useState } from 'react'
import { toast } from 'sonner'
import * as apis from '@/core/apis/apis'
import { Input } from '@/components/ui/input'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ISceneNode } from '@/core/scene/iscene'
import { Separator } from '@/components/ui/separator'
import { RectangleCoordinates } from '../patches/types'
import { Grid3x2, MapPin, Square, X } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ResponseWithGridSchema } from '@/core/apis/types'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import MapContainer from '@/components/mapContainer/mapContainer'
import { addMapLineBetweenPoints, addMapMarker, addMapPatchBounds, adjustPatchBounds, calculateGridCounts, clearDrawPatchBounds, clearGridLines, clearMapMarkers, convertSinglePointCoordinate, convertToWGS84, flyToMarker, startDrawingRectangle, stopDrawingRectangle } from '@/components/mapContainer/utils'
import store from '@/store'

const areaTips = [
    { tip1: 'Fill in the name of the Schema and the EPSG code.' },
    { tip2: 'Description is optional.' },
    { tip3: 'Click the button to draw and obtain or manually fill in the coordinates of the reference point.' },
    { tip4: 'Set the grid size for each level.' },
]


export default function AreaPage({ node }: { node: ISceneNode }) {
    const { t } = useTranslation("areaPage")

    const [dragOver, setDragOver] = useState(false)
    const [isDrawingBounds, setIsDrawingBounds] = useState(false)
    const [isAreaConfirmed, setIsAreaConfirmed] = useState(false)


    const [isDrawingPatches, setIsDrawingPatches] = useState(false)

    const patches = useRef<Array<RectangleCoordinates>>([])

    const [, triggerRepaint] = useReducer(x => x + 1, 0)

    const widthCount = useRef<number>(0)
    const heightCount = useRef<number>(0)
    const schemaEPSG = useRef<string>('')
    const schemaNodeKey = useRef<string>('')
    const hasBounds = useRef<boolean>(false)
    const schemaBasePoint = useRef<[number, number]>([0, 0])
    const schemaGridLevel = useRef<[number, number]>([0, 0])
    const schemaMarkerPoint = useRef<[number, number]>([0, 0])
    const targetSchema = useRef<ResponseWithGridSchema | null>(null)
    const drawCoordinates = useRef<RectangleCoordinates | null>(null)
    const originBounds = useRef<[number, number, number, number] | null>(null)
    const inputBounds = useRef<[number, number, number, number] | null>(null)
    const adjustedBounds = useRef<[number, number, number, number] | null>(null)
    ////////////////////////////////////////////////////////////////////////////////////
    const confirmedAreaBounds = useRef<[number, number, number, number] | null>(null)
    ////////////////////////////////////////////////////////////////////////////////////

    const formatSingleValue = (value: number): string => value.toFixed(6)

    ////////////////////////////////////////////////////////////////////////////////////
    // 检查新patch是否在区域边界内
    const isWithinAreaBounds = (patch: RectangleCoordinates): boolean => {
        if (!confirmedAreaBounds.current) return false

        const [minX, minY, maxX, maxY] = confirmedAreaBounds.current

        return (
            patch.southWest[0] >= minX &&
            patch.southWest[1] >= minY &&
            patch.northEast[0] <= maxX &&
            patch.northEast[1] <= maxY
        )
    }

    const adjustPatchToGridSize = (coordinates: RectangleCoordinates): RectangleCoordinates | null => {
        if (!targetSchema.current?.grid_schema?.grid_info?.[0]) {
            return null
        }

        const [gridWidth, gridHeight] = targetSchema.current.grid_schema.grid_info[0]

        const patchWidth = coordinates.northEast[0] - coordinates.southWest[0]
        const patchHeight = coordinates.northEast[1] - coordinates.southWest[1]

        const adjustedWidth = Math.ceil(patchWidth / gridWidth) * gridWidth
        const adjustedHeight = Math.ceil(patchHeight / gridHeight) * gridHeight

        const adjustedCoordinates: RectangleCoordinates = {
            southWest: coordinates.southWest,
            southEast: [coordinates.southWest[0] + adjustedWidth, coordinates.southWest[1]],
            northEast: [coordinates.southWest[0] + adjustedWidth, coordinates.southWest[1] + adjustedHeight],
            northWest: [coordinates.southWest[0], coordinates.southWest[1] + adjustedHeight],
            center: [coordinates.southWest[0] + adjustedWidth / 2, coordinates.southWest[1] + adjustedHeight / 2]
        }

        return adjustedCoordinates
    }
    ////////////////////////////////////////////////////////////////////////////////////

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        setDragOver(true)
    }

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault()
        setDragOver(false)
    }

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault()
        setDragOver(false)

        const nodeKey = e.dataTransfer.getData('text/plain')

        const schemaName = nodeKey.split('.').pop()
        const schemaPath = nodeKey.split('.').slice(0, -1)
        const lastElement = schemaPath[schemaPath.length - 1]

        if (schemaNodeKey.current === nodeKey) return

        if (lastElement === 'schemas' && nodeKey) {
            clearAllElements()

            schemaNodeKey.current = nodeKey

            targetSchema.current = await apis.schema.getSchema.fetch(schemaName as string, false)
            schemaEPSG.current = targetSchema.current?.grid_schema?.epsg?.toString() || ''

            const schemaOriginalPos = targetSchema.current?.grid_schema?.base_point || [0, 0]
            const gridInfo = targetSchema.current?.grid_schema?.grid_info?.[0] || [1, 1]

            schemaBasePoint.current = [schemaOriginalPos[0], schemaOriginalPos[1]]
            schemaGridLevel.current = [gridInfo[0], gridInfo[1]]
            schemaMarkerPoint.current = convertSinglePointCoordinate(schemaOriginalPos, schemaEPSG.current, '4326')
            addMapMarker(schemaMarkerPoint.current)
        }
        triggerRepaint()
    }

    const onDrawComplete = (event: Event) => {
        const customEvent = event as CustomEvent<{ coordinates: RectangleCoordinates | null }>
        if (customEvent.detail.coordinates) {
            ////////////////////////////////////////////////////////////////////////////////////
            if (isDrawingPatches) {
                // 处理patch绘制
                handlePatchDrawComplete(customEvent.detail.coordinates)
                // 继续保持绘制模式，不停止绘制
            } else {
                // 处理区域边界绘制
                drawCoordinates.current = customEvent.detail.coordinates
                adjustCoords()
                addMapPatchBounds([customEvent.detail.coordinates.southWest[0], customEvent.detail.coordinates.southWest[1], customEvent.detail.coordinates.northEast[0], customEvent.detail.coordinates.northEast[1]], '4326')
                document.removeEventListener('rectangle-draw-complete', onDrawComplete)
                setIsDrawingBounds(false)
                stopDrawingRectangle()
                triggerRepaint()
            }
        }
    }

    const handlePatchDrawComplete = (coordinates: RectangleCoordinates) => {

        const adjustedPatch = adjustPatchToGridSize(coordinates)
        if (!adjustedPatch) {
            toast.error(t('Failed to adjust patch to grid size'))
            return
        }

        if (!isWithinAreaBounds(adjustedPatch)) {
            toast.error(t('Patch must be within the confirmed area bounds'))
            return
        }

        patches.current = [...patches.current, adjustedPatch]

        const patchId = `patch-${Date.now()}`
        addMapPatchBounds([
            adjustedPatch.southWest[0],
            adjustedPatch.southWest[1],
            adjustedPatch.northEast[0],
            adjustedPatch.northEast[1]
        ], patchId, false, {
            fillColor: '#FF6B6B',
            opacity: 0.3,
            lineColor: '#FF6B6B',
            lineWidth: 2,
        })

        toast.success(t('Patch added successfully'))
        
        triggerRepaint()
        ////////////////////////////////////////////////////////////////////////////////////
    }

    const clearAllElements = () => {
        clearMapMarkers()
        clearGridLines()
        clearDrawPatchBounds()

        schemaEPSG.current = ''
        originBounds.current = null
        inputBounds.current = null  // maybe dont need to reset
        adjustedBounds.current = null
        ////////////////////////////////////////////////////////////////////////////////////
        confirmedAreaBounds.current = null
        ////////////////////////////////////////////////////////////////////////////////////
        schemaBasePoint.current = [0, 0]
        schemaGridLevel.current = [0, 0]
        schemaMarkerPoint.current = [0, 0]
        drawCoordinates.current = null
        widthCount.current = 0
        heightCount.current = 0
        hasBounds.current = false
        ////////////////////////////////////////////////////////////////////////////////////
        patches.current = []
        setIsDrawingPatches(false)
        ////////////////////////////////////////////////////////////////////////////////////

        triggerRepaint()
    }

    const adjustCoords = () => {

        clearMapMarkers()
        addMapMarker(schemaMarkerPoint.current)
        clearGridLines()
        clearDrawPatchBounds()

        const coords = drawCoordinates.current!
        originBounds.current = [coords.southWest[0], coords.southWest[1], coords.northEast[0], coords.northEast[1]]      // EPSG: 4326
        const drawBounds = originBounds.current                                                                           // EPSG: 4326

        if (drawBounds && drawBounds.length === 4 && schemaEPSG.current && schemaBasePoint.current && schemaGridLevel.current) {

            const patchBounds = drawBounds
            const fromEPSG = '4326'

            const { convertedBounds, alignedBounds, expandedBounds } = adjustPatchBounds(patchBounds!, schemaGridLevel.current, fromEPSG, schemaEPSG.current, schemaBasePoint.current)      // EPSG: Schema

            if (!expandedBounds || !convertedBounds) {
                console.error('Failed to adjust patch bounds')
                toast.error(t('Failed to adjust coordinate bounds'))
                return
            }

            inputBounds.current = [expandedBounds.southWest[0], expandedBounds.southWest[1], expandedBounds.northEast[0], expandedBounds.northEast[1]]  // EPSG: Schema

            const alignedSWPoint = convertSinglePointCoordinate(expandedBounds.southWest, schemaEPSG.current, '4326')
            const alignedNEPoint = convertSinglePointCoordinate(expandedBounds.northEast, schemaEPSG.current, '4326')
            addMapMarker(alignedSWPoint, { color: 'red', draggable: false })
            adjustedBounds.current = [alignedSWPoint[0], alignedSWPoint[1], alignedNEPoint[0], alignedNEPoint[1]]

            const adjustedDrawBoundsOn4326 = [alignedSWPoint[0], alignedSWPoint[1], alignedNEPoint[0], alignedNEPoint[1]] as [number, number, number, number]
            addMapPatchBounds(adjustedDrawBoundsOn4326, 'adjusted-bounds')

            const { widthCounts, heightCounts } = calculateGridCounts(expandedBounds.southWest, schemaBasePoint.current, schemaGridLevel.current)
            widthCount.current = widthCounts
            heightCount.current = heightCounts

            addMapLineBetweenPoints(schemaMarkerPoint.current, alignedSWPoint, widthCounts, heightCounts)
            hasBounds.current = true
        }

        triggerRepaint()
    }

    const handleDrawAreaBounds = () => {
        if (isDrawingBounds) {
            setIsDrawingBounds(false)
            stopDrawingRectangle()
            document.removeEventListener('rectangle-draw-complete', onDrawComplete)
            return
        } else {
            setIsDrawingBounds(true)
            startDrawingRectangle()
            document.addEventListener('rectangle-draw-complete', onDrawComplete)
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////
    const handleDrawPatches = () => {
        if (isDrawingPatches) {
            setIsDrawingPatches(false)
            stopDrawingRectangle()
            document.removeEventListener('rectangle-draw-complete', onDrawComplete)
            return
        } else {
            setIsDrawingPatches(true)
            startDrawingRectangleWithSnap()
            document.addEventListener('rectangle-draw-complete', onDrawComplete)
        }
    }

    const startDrawingRectangleWithSnap = () => {
        const draw = store.get('mapDraw') as any
        if (!draw) {
            console.error('MapboxDraw instance not found')
            return false
        }

        try {
            draw.deleteAll()
            draw.changeMode('draw_rectangle')
            return true
        } catch (error) {
            console.error('Start drawing rectangle with snap error:', error)
            return false
        }
    }

    const clearAllPatches = () => {
        patches.current = []

        clearDrawPatchBounds()
        
        if (confirmedAreaBounds.current) {
            addMapPatchBounds(confirmedAreaBounds.current, 'confirmed-area', true, {
                fillColor: '#00FF00',
                opacity: 0,
                lineColor: '#FFFD00',
                lineWidth: 4,
            })
        }
        toast.success(t('All patches cleared'))
        triggerRepaint()
    }
    ////////////////////////////////////////////////////////////////////////////////////

    const drawBoundsByParams = () => {
        const inputBounding = inputBounds.current
        if (hasBounds.current) {
            toast.info(t('Map bounds have been adjusted'))
            return
        }

        if (inputBounding && inputBounding.length === 4) {
            clearMapMarkers()
            addMapMarker(schemaMarkerPoint.current)
            clearDrawPatchBounds()
            clearGridLines()
            const inputBoundsOn4326 = convertToWGS84(inputBounding!, schemaEPSG.current)

            drawCoordinates.current = {
                southWest: [inputBoundsOn4326[0], inputBoundsOn4326[1]],
                southEast: [inputBoundsOn4326[2], inputBoundsOn4326[1]],
                northEast: [inputBoundsOn4326[2], inputBoundsOn4326[3]],
                northWest: [inputBoundsOn4326[0], inputBoundsOn4326[3]],
                center: [(inputBoundsOn4326[0] + inputBoundsOn4326[2]) / 2, (inputBoundsOn4326[1] + inputBoundsOn4326[3]) / 2],
            }
            adjustCoords()
            addMapPatchBounds(inputBoundsOn4326, '4326')
        }
    }

    const handleSetInputBounds = (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
        if (!inputBounds.current) {
            inputBounds.current = [0, 0, 0, 0]
        }
        const value = parseFloat(e.target.value) || 0
        inputBounds.current[index] = value
        hasBounds.current = false // reset adjusted bounds flag because input bounds have changed
        triggerRepaint()
    }

    const handleSubmit = () => {
        const areaBounds = adjustedBounds.current

        clearMapMarkers()
        clearGridLines()
        clearDrawPatchBounds()

        ////////////////////////////////////////////////////////////////////////////////////
        addMapPatchBounds(areaBounds!, 'confirmed-area', true, {
        ////////////////////////////////////////////////////////////////////////////////////
            fillColor: '#00FF00',
            opacity: 0,
            lineColor: '#FFFD00',
            lineWidth: 4,
        })

        ////////////////////////////////////////////////////////////////////////////////////
        // 保存确定的区域边界
        confirmedAreaBounds.current = areaBounds
        ////////////////////////////////////////////////////////////////////////////////////

        setIsAreaConfirmed(true)
        toast.success(t('Resource area confirmed successfully'))
    }

    return (
        <div className='w-full h-[96vh] flex flex-row'>
            <div className='w-2/5 h-full flex flex-col'>
                <div className='flex-1 overflow-hidden'>
                    {/* ----------------- */}
                    {/* Page Introduction */}
                    {/* ----------------- */}
                    <div className='w-full border-b border-gray-700 flex flex-row'>
                        {/* ------------*/}
                        {/* Page Avatar */}
                        {/* ------------*/}
                        <div className='w-1/3 h-full flex justify-center items-center my-auto'>
                            <Avatar className='h-28 w-28 border-2 border-white'>
                                <AvatarFallback className='bg-[#007ACC]'>
                                    <Grid3x2 className='h-15 w-15 text-white' />
                                </AvatarFallback>
                            </Avatar>
                        </div>
                        {/* -----------------*/}
                        {/* Page Description */}
                        {/* -----------------*/}
                        <div className='w-2/3 h-full p-4 space-y-2 text-white'>
                            {/* -----------*/}
                            {/* Page Title */}
                            {/* -----------*/}
                            <h1 className='font-bold text-[25px] relative flex items-center'>
                                {t('Create New Area')}
                                <span className='bg-[#D63F26] rounded px-0.5 mb-2 text-[12px] inline-flex items-center mx-1'>{t('Private')}</span>
                            </h1>
                            {/* ----------*/}
                            {/* Page Tips */}
                            {/* ----------*/}
                            <div className='text-sm p-2 px-4 w-full'>
                                <ul className='list-disc space-y-1'>
                                    {areaTips.map((tip, index) => (
                                        <li key={index}>
                                            {t(Object.values(tip)[0])}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    </div>
                    {/* ---------------- */}
                    {/* Grid Schema Form */}
                    {/* ---------------- */}
                    <ScrollArea className='h-full max-h-[calc(100vh-14.5rem)]'>
                        {/* Step 1: Area Name */}
                        <div className='w-2/3 mx-auto mt-4 space-y-4 pb-4'>
                            {/* ----------- */}
                            {/* Area Name */}
                            {/* ----------- */}
                            <div className='bg-white rounded-lg shadow-sm p-4 border border-gray-200'>
                                <h2 className='text-lg font-semibold mb-2'>
                                    {t('Area Name')}
                                </h2>
                                <div className='space-y-2'>
                                    <Input
                                        id='name'
                                        placeholder={t('Enter new area name')}
                                        className='w-full text-black border-gray-300'
                                    />
                                </div>
                            </div>
                            <Separator className='w-[70%] mx-auto border-dashed border-gray-300' />
                        </div>
                        {/* Step 2: Draw Area Bounds */}
                        <div className='w-2/3 mx-auto mb-4 space-y-4 pb-4'>
                            {/* --------- */}
                            {/* Belong To Schema */}
                            {/* --------- */}
                            <div className='bg-white rounded-lg shadow-sm p-4 border border-gray-200'>
                                <h2 className='text-lg font-semibold mb-2'>
                                    {t('Belong To Schema')}
                                </h2>
                                <div
                                    className={`border-2 h-16 border-dashed rounded-lg p-4 flex items-center justify-center transition-colors ${isAreaConfirmed
                                        ? 'border-gray-300 bg-gray-100 cursor-not-allowed'
                                        : dragOver
                                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                                            : 'border-gray-300 dark:border-gray-600'
                                        }`}
                                    onDragOver={!isAreaConfirmed ? handleDragOver : undefined}
                                    onDragLeave={!isAreaConfirmed ? handleDragLeave : undefined}
                                    onDrop={!isAreaConfirmed ? handleDrop : undefined}
                                >
                                    {targetSchema.current ? (
                                        <div className="flex items-center justify-center gap-2 border-2 border-gray-300 rounded-lg p-2">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => flyToMarker(schemaMarkerPoint.current, 12)}
                                                className='h-6 w-6 p-0 cursor-pointer'
                                            >
                                                <MapPin className="w-4 h-4 text-blue-500" />
                                            </Button>
                                            <span className="text-md font-bold">{targetSchema.current.grid_schema?.name}</span>
                                            <span className='text-xs text-gray-500'>Level 1: {targetSchema.current.grid_schema?.grid_info[0][0]}×{targetSchema.current.grid_schema?.grid_info[0][1]}</span>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                disabled={isAreaConfirmed}
                                                onClick={() => {
                                                    targetSchema.current = null
                                                    clearAllElements()
                                                    triggerRepaint()
                                                }}
                                                className={`h-6 w-6 p-0 ${isAreaConfirmed ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                                            >
                                                <X className="w-3 h-3" />
                                            </Button>
                                        </div>
                                    ) : (
                                        <div className="text-sm text-muted-foreground">
                                            Drag a Schema Resource Node here
                                        </div>
                                    )}
                                </div>
                            </div>
                            {/* ------------------ */}
                            {/* Area EPSG Code */}
                            {/* ------------------ */}
                            <div className='bg-white rounded-lg shadow-sm p-4 border border-gray-200'>
                                <h2 className='text-lg font-semibold mb-2'>
                                    {t('EPSG Code')}
                                </h2>
                                <div className='space-y-2'>
                                    <Input
                                        id='epsg'
                                        readOnly={true}
                                        value={targetSchema.current?.grid_schema?.epsg?.toString() || ''}
                                        placeholder={t('Get EPSG Code from Schema')}
                                        className={`text-black w-full border-gray-300`}
                                    />
                                </div>
                            </div>
                            {/* --------- */}
                            {/* Area Bounds */}
                            {/* --------- */}
                            <div className='bg-white rounded-lg shadow-sm p-4 border border-gray-200'>
                                <h2 className='text-lg font-semibold mb-2'>
                                    {t('Area Bounds')}
                                </h2>
                                <div className='space-y-2'>
                                    <div className='p-2 bg-white rounded-md shadow-sm border border-gray-200'>
                                        <div className='font-bold text-md mb-2'>
                                            {t('Method One: Draw to generate')}
                                        </div>
                                        <button
                                            type='button'
                                            onClick={handleDrawAreaBounds}
                                            disabled={!targetSchema.current || isAreaConfirmed}
                                            className={`w-full py-2 px-4 shadow-sm rounded-md font-medium transition-colors ${!targetSchema.current || isAreaConfirmed
                                                ? 'bg-gray-400 text-gray-600 cursor-not-allowed'
                                                : isDrawingBounds
                                                    ? 'bg-red-500 text-white hover:bg-red-600 cursor-pointer'
                                                    : 'bg-blue-500 text-white hover:bg-blue-600 cursor-pointer'
                                                }`}
                                        >
                                            {!targetSchema.current
                                                ? t('Please upload Schema first')
                                                : isAreaConfirmed
                                                    ? t('Area confirmed - editing disabled')
                                                    : isDrawingBounds
                                                        ? t('Click to cancel rectangle drawing')
                                                        : t('Click to draw rectangle')}
                                        </button>
                                        {isDrawingBounds && (
                                            <div className='mt-2 p-2 bg-yellow-50 rounded-md border border-yellow-200 text-xs text-yellow-800'>
                                                <p>{t('Drawing method:')}</p>
                                                <ul className='list-disc pl-4 mt-1'>
                                                    <li>
                                                        {t('Click on the map to set starting point')}
                                                    </li>
                                                    <li>
                                                        {t('Move the mouse to desired location')}
                                                    </li>
                                                    <li>
                                                        {t('Click again to complete drawing')}
                                                    </li>
                                                </ul>
                                            </div>
                                        )}
                                    </div>
                                    <Separator className='h-px mb-2 bg-gray-300' />
                                    <div className=' p-2 bg-white rounded-md shadow-sm border border-gray-200'>
                                        <div className='mb-2 font-bold text-md'>
                                            {t('Method Two: Input parameters to generate')}
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
                                                    value={inputBounds.current?.[3] ?? ''}
                                                    onChange={(e) => handleSetInputBounds(e, 3)}
                                                    disabled={isAreaConfirmed}
                                                    className={`w-full text-center border border-gray-500 rounded-sm h-[22px] ${isAreaConfirmed ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                                                    placeholder={t('Enter max Y')}
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
                                                    value={inputBounds.current?.[0] ?? ''}
                                                    onChange={(e) => handleSetInputBounds(e, 0)}
                                                    disabled={isAreaConfirmed}
                                                    className={`w-full text-center border border-gray-500 rounded-sm h-[22px] ${isAreaConfirmed ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                                                    placeholder={t('Enter min X')}
                                                    step='any'
                                                />
                                            </div>
                                            {/* Center */}
                                            <div className='text-center'>
                                                <span className='font-bold text-[#FF8F2E] text-xl'>{t('Center')}</span>
                                                <div
                                                    className='text-[10px] mt-1'
                                                >
                                                    {inputBounds.current
                                                        ? `${formatSingleValue(
                                                            (inputBounds.current[0] + inputBounds.current[2]) / 2
                                                        )}, ${formatSingleValue(
                                                            (inputBounds.current[1] + inputBounds.current[3]) / 2
                                                        )}`
                                                        : t('Enter bounds')}
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
                                                    value={inputBounds.current?.[2] ?? ''}
                                                    onChange={(e) => handleSetInputBounds(e, 2)}
                                                    disabled={isAreaConfirmed}
                                                    className={`w-full text-center border border-gray-500 rounded-sm h-[22px] ${isAreaConfirmed ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                                                    placeholder={t('Enter max X')}
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
                                                    value={inputBounds.current?.[1] ?? ''}
                                                    onChange={(e) => handleSetInputBounds(e, 1)}
                                                    disabled={isAreaConfirmed}
                                                    className={`w-full text-center border border-gray-500 rounded-sm h-[22px] ${isAreaConfirmed ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                                                    placeholder={t('Enter min Y')}
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
                                            disabled={!targetSchema.current || isAreaConfirmed}
                                            className={`w-full py-2 px-4 shadow-sm rounded-md font-medium transition-colors ${!targetSchema.current || isAreaConfirmed
                                                ? 'bg-gray-400 text-gray-600 cursor-not-allowed'
                                                : 'bg-blue-500 text-white hover:bg-blue-600 cursor-pointer'
                                                }`}
                                            onClick={drawBoundsByParams}
                                        >
                                            {!targetSchema.current
                                                ? t('Please upload Schema first')
                                                : isAreaConfirmed
                                                    ? t('Area confirmed - editing disabled')
                                                    : t('Click to adjust and draw bounds')}
                                        </button>
                                    </div>
                                </div>
                            </div>
                            {/* ------ */}
                            {/* Submit */}
                            {/* ------ */}
                            <div className='mt-4'>
                                <Button
                                    onClick={handleSubmit}
                                    className='w-full bg-green-600 hover:bg-green-700 text-white cursor-pointer'
                                >
                                    <Square className='h-4 w-4 mr-1' />
                                    {t('Step 1: Confirm Resource Area')}
                                </Button>
                            </div>
                            <Separator className='border-dashed border-gray-300' />
                        </div>
                        {/* Step 3: Divide Patches */}
                        <div className='w-2/3 mx-auto mb-4 pb-4'>
                            <div className='bg-white rounded-lg shadow-sm p-4 border border-gray-200'>
                                <h2 className='text-lg font-semibold mb-2'>
                                    {t('Divide Patches')}
                                </h2>
                                <div className='space-y-2'>
                                    <div className='p-2 bg-white rounded-md shadow-sm border border-gray-200'>
                                        <div className='font-bold text-md mb-2'>
                                            {t('Draw every patch')}
                                        </div>
                                        <button
                                            type='button'
                                            onClick={handleDrawPatches}
                                            disabled={!isAreaConfirmed}
                                            className={`w-full py-2 px-4 shadow-sm rounded-md font-medium transition-colors ${!isAreaConfirmed
                                                ? 'bg-gray-400 text-gray-600 cursor-not-allowed'
                                                : isDrawingPatches
                                                    ? 'bg-red-500 text-white hover:bg-red-600 cursor-pointer'
                                                    : 'bg-blue-500 text-white hover:bg-blue-600 cursor-pointer'
                                                }`}
                                        >
                                            {!isAreaConfirmed
                                                ? t('Please confirm area first')
                                                : isDrawingPatches
                                                    ? t('Click to cancel patch drawing')
                                                    : t('Click to draw patch')}
                                        </button>
                                        {isDrawingPatches && (
                                            <div className='mt-2 p-2 bg-yellow-50 rounded-md border border-yellow-200 text-xs text-yellow-800'>
                                                <p>{t('Patch drawing method:')}</p>
                                                <ul className='list-disc pl-4 mt-1'>
                                                    <li>
                                                        {t('Click on the map to set starting point')}
                                                    </li>
                                                    <li>
                                                        {t('Drag to desired size and position')}
                                                    </li>
                                                    <li>
                                                        {t('Click again to complete the patch')}
                                                    </li>
                                                    <li className='text-green-600 font-medium'>
                                                        {t('Patch size will be adjusted to grid multiples')}
                                                    </li>
                                                </ul>
                                            </div>
                                        )}
                                        {isAreaConfirmed && (
                                            <div className='mt-2'>
                                                <div className='flex justify-between items-center mb-2'>
                                                    <span className='text-sm font-medium'>
                                                        {t('Patches')}: {patches.current.length}
                                                    </span>
                                                    {patches.current.length > 0 && (
                                                        <button
                                                            type='button'
                                                            onClick={clearAllPatches}
                                                            className='text-xs bg-red-100 text-red-600 px-2 py-1 rounded hover:bg-red-200'
                                                        >
                                                            {t('Clear All')}
                                                        </button>
                                                    )}
                                                </div>
                                                {patches.current.length > 0 && (
                                                    <div className='max-h-32 overflow-y-auto bg-gray-50 rounded p-2'>
                                                        {patches.current.map((patch, index) => (
                                                            <div key={index} className='text-xs mb-1 p-1 bg-white rounded border'>
                                                                <span className='font-medium'>Patch {index + 1}:</span>
                                                                <br />
                                                                SW: [{patch.southWest[0].toFixed(4)}, {patch.southWest[1].toFixed(4)}]
                                                                <br />
                                                                NE: [{patch.northEast[0].toFixed(4)}, {patch.northEast[1].toFixed(4)}]
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                                {patches.current.length === 0 && (
                                                    <div className='text-xs text-gray-500 text-center py-2'>
                                                        {t('No patches drawn yet')}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </ScrollArea>
                </div>
            </div>
            <div className='w-3/5 h-full py-4 pr-4'>
                <MapContainer node={node} style='w-full h-full rounded-lg shadow-lg bg-gray-200' />
            </div>
        </div>
    )
}
