import { useEffect, useReducer, useRef, useState } from 'react'
import { toast } from 'sonner'
import * as api from '../noodle/apis'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { GridLayerInfo, SchemaData } from './types'
import { IViewContext } from '@/views/IViewContext'
import { MapViewContext } from '@/views/mapView/mapView'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Crosshair, MapPin, MapPinPlus, Save, X } from 'lucide-react'
import { addMapMarker, clearMapMarkers, convertPointCoordinate, pickCoordsFromMap } from '@/utils/utils'
import { ResourceTree } from '../scene/scene'
import { IResourceNode } from '../scene/iscene'

interface SchemaCreationProps {
    node: IResourceNode
    // tree: ResourceTree
    context: IViewContext
}

interface GridLayer {
    id: number
    width: string
    height: string
}

interface PageContext {
    name: string
    epsg: number | null
    alignmentOrigin: [number, number]
    gridLayers: GridLayer[]
}

interface FormErrors {
    name: boolean
    epsg: boolean
    coordinates: boolean
}

interface ValidationResult {
    isValid: boolean
    errors: FormErrors
    generalError: string | null
}

const schemaTips = [
    { tip1: 'Fill in the name of the Schema and the EPSG code.' },
    { tip2: 'Click the button to draw and obtain or manually fill in the coordinates of the reference point.' },
    { tip3: 'Set the grid size for each level.' },
]

const gridLevelText = {
    title: 'Grid Level',
    addButton: 'Add Grid Level',
    noLayers: 'No layers added yet. Click the button above to add a layer.',
    rulesTitle: 'Grid levels should follow these rules:',
    rule1: 'Each level should have smaller cell dimensions than the previous level',
    rule2: "Previous level's width/height must be a multiple of the current level's width/height",
    rule3: 'First level defines the base grid cell size, and higher levels define increasingly finer grids'
}

const gridItemText = {
    level: 'Level',
    remove: 'Remove',
    width: 'Width/m',
    height: 'Height/m',
    widthPlaceholder: 'Width',
    heightPlaceholder: 'Height'
}

const validateGridLayers = (gridLayers: GridLayerInfo[]): { errors: Record<number, string>, isValid: boolean } => {
    const errors: Record<number, string> = {}
    let isValid = true

    const errorText = {
        and: () => ` and `,
        empty: () => 'Width and height cannot be empty',
        notPositive: () => 'Width and height must be positive numbers',
        notSmaller: (prevWidth: number, prevHeight: number) => `Cell dimensions should be smaller than previous level (${prevWidth}×${prevHeight})`,
        notMultiple: (prevWidth: number, currentWidth: number, prevHeight: number, currentHeight: number) => `Previous level's dimensions (${prevWidth}×${prevHeight}) must be multiples of current level (${currentWidth}×${currentHeight})`,
        widthNotSmaller: (prevWidth: number) => `Width must be smaller than previous level (${prevWidth})`,
        widthNotMultiple: (prevWidth: number, currentWidth: number) => `Previous level's width (${prevWidth}) must be a multiple of current width (${currentWidth})`,
        heightNotSmaller: (prevHeight: number) => `Height must be smaller than previous level (${prevHeight})`,
        heightNotMultiple: (prevHeight: number, currentHeight: number) => `Previous level's height (${prevHeight}) must be a multiple of current height (${currentHeight})`,
    }

    gridLayers.forEach((layer, index) => {
        delete errors[layer.id]
        const width = String(layer.width).trim()
        const height = String(layer.height).trim()

        if (width == '' || height == '') {
            errors[layer.id] = errorText.empty()
            isValid = false
            return
        }

        const currentWidth = Number(width)
        const currentHeight = Number(height)

        if (index > 0) {
            const prevLayer = gridLayers[index - 1]
            const prevWidth = Number(String(prevLayer.width).trim())
            const prevHeight = Number(String(prevLayer.height).trim())

            let hasWidthError = false
            if (currentWidth >= prevWidth) {
                errors[layer.id] = errorText.widthNotSmaller(prevWidth)
                hasWidthError = true
                isValid = false
            } else if (prevWidth % currentWidth !== 0) {
                errors[layer.id] = errorText.widthNotMultiple(
                    prevWidth,
                    currentWidth
                )
                hasWidthError = true
                isValid = false
            }

            if (currentHeight >= prevHeight) {
                if (hasWidthError) {
                    errors[layer.id] +=
                        errorText.and +
                        errorText.heightNotSmaller(prevHeight)
                } else {
                    errors[layer.id] =
                        errorText.heightNotSmaller(prevHeight)
                }
                isValid = false
            } else if (prevHeight % currentHeight !== 0) {
                if (hasWidthError) {
                    errors[layer.id] +=
                        errorText.and +
                        errorText.heightNotMultiple(
                            prevHeight,
                            currentHeight
                        )
                } else {
                    errors[layer.id] = errorText.heightNotMultiple(
                        prevHeight,
                        currentHeight
                    )
                }
                isValid = false
            }
        }
    })
    return { errors, isValid }
}

const validateSchemaForm = (
    data: {
        name: string
        epsg: number
        lon: string
        lat: string
        gridLayerInfos: GridLayerInfo[]
        convertedCoord: [number, number] | null
    },
): ValidationResult => {
    const errors = {
        name: false,
        epsg: false,
        description: false,
        coordinates: false,
    }
    let generalError: string | null = null

    if (!data.name.trim()) {
        errors.name = true
        generalError = 'Please enter schema name'
        return { isValid: false, errors, generalError }
    }

    if (!data.epsg || isNaN(Number(data.epsg))) {
        errors.epsg = true
        generalError = 'Please enter a valid EPSG code'
        return { isValid: false, errors, generalError }
    }

    if (!data.lon.trim() || !data.lat.trim() || isNaN(Number(data.lon)) || isNaN(Number(data.lat))) {
        errors.coordinates = true
        generalError = 'Please enter valid coordinates'
        return { isValid: false, errors, generalError }
    }

    if (data.gridLayerInfos.length === 0) {
        generalError = 'Please add at least one grid level'
        return { isValid: false, errors, generalError }
    }
    for (let i = 0; i < data.gridLayerInfos.length; i++) {
        const layer = data.gridLayerInfos[i]
        if (
            !layer.width.toString().trim() ||
            !layer.height.toString().trim() ||
            isNaN(parseInt(layer.width.toString())) ||
            isNaN(parseInt(layer.height.toString()))
        ) {
            generalError = `Please enter valid width and height for grid level ${i + 1}`
            return { isValid: false, errors, generalError }
        }
    }
    const { errors: layerErrors, isValid: gridInfoValid } = validateGridLayers(data.gridLayerInfos)
    if (!gridInfoValid) {
        generalError = 'Please fix errors in grid levels'
        return { isValid: false, errors, generalError }
    }

    if (!data.convertedCoord) {
        generalError = 'Unable to get converted coordinates'
        return { isValid: false, errors, generalError }
    }

    return { isValid: true, errors, generalError }
}

export default function SchemaCreation({
    node,
    context
}: SchemaCreationProps) {

    const mapContext = context as MapViewContext
    const map = mapContext.map

    ////// TODO:将input内容存入node的_context
    const pageContext = useRef<PageContext>({
        name: '',
        epsg: null,
        alignmentOrigin: [0, 0],
        gridLayers: []
    })
    //////////////////////////////////////////

    const picking = useRef<{ marker: mapboxgl.Marker | null, cancel: () => void }>({ marker: null, cancel: () => { } })

    const [isSelectingPoint, setIsSelectingPoint] = useState(false)
    const [generalMessage, setGeneralMessage] = useState<string | null>(null)
    const [layerErrors, setLayerErrors] = useState<Record<number, string>>({})
    const [convertedCoord, setConvertedCoord] = useState<[number, number] | null>(null)
    const [formErrors, setFormErrors] = useState<FormErrors>({
        name: false,
        epsg: false,
        coordinates: false,
    })

    const newSchemaName = node.name.split(' ')[0]

    const isFolder = node.template_name === 'default'

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
        console.log(node.name.split(' ')[0])
        triggerRepaint()
    }

    const unloadContext = async () => {
        return
    }

    const handleSetName = (e: React.ChangeEvent<HTMLInputElement>) => {
        pageContext.current.name = e.target.value
        triggerRepaint()
    }

    const handleSetEPSG = (e: React.ChangeEvent<HTMLInputElement>) => {
        pageContext.current.epsg = parseInt(e.target.value)
        updateCoords()
        triggerRepaint()
    }

    const updateCoords = async () => {
        const pc = pageContext.current
        const epsg = pc.epsg
        const alignmentOrigin = pc.alignmentOrigin
        let converted: [number, number] | null = null
        if (alignmentOrigin[0] && alignmentOrigin[1] && epsg) {
            if (epsg < 1000 || epsg > 32767) converted = null

            else if (epsg.toString().length < 4) converted = null

            else converted = await convertPointCoordinate(alignmentOrigin, 4326, epsg)
        }
        setConvertedCoord(converted)
    }

    const handleSetAlignmentOriginLon = (e: React.ChangeEvent<HTMLInputElement>) => {
        pageContext.current.alignmentOrigin[0] = parseFloat(e.target.value)
        updateCoords()
        triggerRepaint()
    }

    const handleSetAlignmentOriginLat = (e: React.ChangeEvent<HTMLInputElement>) => {
        pageContext.current.alignmentOrigin[1] = parseFloat(e.target.value)
        updateCoords()
        triggerRepaint()
    }

    const handlePickAlignmentOrigin = () => {
        if (!map) return

        if (isSelectingPoint) {
            setIsSelectingPoint(false)
            picking.current.cancel()
            picking.current.cancel = () => { }
            return
        }

        clearMapMarkers()
        picking.current.marker = null

        picking.current.cancel = pickCoordsFromMap(map, { color: '#FF0000' }, (marker) => {
            picking.current.marker = marker

            const pc = pageContext.current
            const bp = marker.getLngLat()
            pc.alignmentOrigin = [bp.lng, bp.lat]
            updateCoords()
            setIsSelectingPoint(false)
        })

        setIsSelectingPoint(true)
    }

    const handleDrawAlignmentOrigin = () => {
        if (!map || !pageContext.current.alignmentOrigin) return
        clearMapMarkers()
        addMapMarker(map, pageContext.current.alignmentOrigin)
    }

    const handleAddGridLayer = () => {
        const gridLayers = pageContext.current.gridLayers
        gridLayers[gridLayers.length] = {
            id: gridLayers.length,
            width: '',
            height: ''
        }
        triggerRepaint()
    }

    const handleUpdateGridSize = (id: number, width: string, height: string) => {
        const gridLayers = pageContext.current.gridLayers
        if (id >= gridLayers.length) gridLayers[id] = { id, width, height }
        gridLayers[id] = { id, width, height }

        const { errors } = validateGridLayers(gridLayers)
        setLayerErrors(errors)
        triggerRepaint()
    }

    const handleRemoveLayer = (id: number) => {

        if (id >= pageContext.current.gridLayers.length) return

        pageContext.current.gridLayers = pageContext.current.gridLayers.filter(layer => layer.id !== id)
        pageContext.current.gridLayers.forEach((layer, index) => layer.id = index)

        const { errors } = validateGridLayers(pageContext.current.gridLayers)
        setLayerErrors(errors)
        triggerRepaint()
    }

    const resetForm = async () => {

        picking.current.marker?.remove()

        setFormErrors({
            name: false,
            epsg: false,
            coordinates: false,
        })
        setLayerErrors({})
        setGeneralMessage(null)
        setConvertedCoord(null)
        setIsSelectingPoint(false)

        triggerRepaint()
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        const validation = validateSchemaForm({
            name: pageContext.current.name,
            epsg: pageContext.current.epsg!,
            lon: pageContext.current.alignmentOrigin[0].toString(),
            lat: pageContext.current.alignmentOrigin[1].toString(),
            gridLayerInfos: pageContext.current.gridLayers,
            convertedCoord
        })

        if (!validation.isValid) {
            setFormErrors(validation.errors)
            setGeneralMessage(validation.generalError)
            return
        }

        const schemaData: SchemaData = {
            name: pageContext.current.name,
            epsg: pageContext.current.epsg!,
            alignment_origin: pageContext.current.alignmentOrigin,
            grid_info: pageContext.current.gridLayers.map(layer => [parseFloat(layer.width), parseFloat(layer.height)]),
        }

        const parentKey = node?.key === '.' ? '.' : node?.key || '.'
        const mountKey = parentKey === '.' ? `.${pageContext.current.name}` : `${parentKey}.${pageContext.current.name}`
        // const mountKey = `.${pageContext.current.name}`

        setGeneralMessage('Submitting data...')
        try {
            await api.node.mountNode({
                node_key: mountKey,
                template_name: 'schema',
                mount_params_string: JSON.stringify(schemaData)
            })

            setGeneralMessage('Created successfully')

            const tree = node?.tree as ResourceTree
            await tree.refresh()

            toast.success('Created successfully')
        } catch (error) {
            setGeneralMessage(`Failed to create schema: ${error}`)
            toast.error(`Failed to create schema: ${error}`)
        }

        resetForm()
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
                            <MapPinPlus className='h-6 w-6 text-white' />
                        </AvatarFallback>
                    </Avatar>
                    <h1 className='font-bold text-[25px] relative flex items-center'>
                        Create New Schema
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
                            {schemaTips.map((tip, index) => (
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
                            New Schema Name
                        </h2>
                        <div className='space-y-2'>
                            <Input
                                id='name'
                                value={pageContext.current.name}
                                onChange={handleSetName}
                                placeholder={'Enter new schema name'}
                                className={`w-full text-black border-gray-300 ${formErrors.name ? 'border-red-500 focus:ring-red-500' : ''
                                    }`}
                            />
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
                                className={`text-black w-full border-gray-300 ${formErrors.epsg ? 'border-red-500 focus:ring-red-500' : ''}`}
                                value={pageContext.current.epsg ? pageContext.current.epsg.toString() : ''}
                                onChange={handleSetEPSG}
                            />
                        </div>
                    </div>
                    {/* ----------------------- */}
                    {/* Coordinates (EPSG:4326) */}
                    {/* ----------------------- */}
                    <div className='bg-white rounded-lg shadow-sm p-4 border border-gray-200'>
                        <h2 className='text-black text-lg font-semibold mb-2'>
                            Coordinates (EPSG:4326)
                        </h2>
                        <div className='flex flex-col lg:flex-row items-stretch gap-4'>
                            <div className='flex-1 flex flex-col text-black gap-3'>
                                <div className='flex flex-col gap-1'>
                                    <Label htmlFor='lon' className='text-sm font-medium'>
                                        Longitude:
                                    </Label>
                                    <Input
                                        id='lon'
                                        type='number'
                                        step='0.000001'
                                        value={pageContext.current.alignmentOrigin[0] || ''}
                                        onChange={handleSetAlignmentOriginLon}
                                        placeholder={'Enter longitude'}
                                        className={`border-gray-300 ${formErrors.coordinates ? 'border-red-500 focus:ring-red-500' : ''
                                            }`}
                                    />
                                </div>
                                <div className='flex flex-col gap-1'>
                                    <Label htmlFor='lat' className='text-sm font-medium'>
                                        Latitude:
                                    </Label>
                                    <Input
                                        id='lat'
                                        type='number'
                                        step='0.000001'
                                        value={pageContext.current.alignmentOrigin[1] || ''}
                                        onChange={handleSetAlignmentOriginLat}
                                        placeholder={'Enter latitude'}
                                        className={`border-gray-300 ${formErrors.coordinates ? 'border-red-500 focus:ring-red-500' : ''
                                            }`}
                                    />
                                </div>
                            </div>
                            <div className='flex flex-col items-center justify-center gap-2'>
                                {/* ---------------------- */}
                                {/* Alignment Origin Map Drawing */}
                                {/* ---------------------- */}
                                <Button
                                    type='button'
                                    onClick={handleDrawAlignmentOrigin}
                                    disabled={!pageContext.current.alignmentOrigin[0] || !pageContext.current.alignmentOrigin[1]}
                                    className={`w-20 h-15 shadow-sm bg-sky-500 hover:bg-sky-600 text-white cursor-pointer`}
                                >
                                    <div className='flex flex-row gap-1 items-center'>
                                        <MapPin className='h-5 w-5 lg:h-6 lg:w-6 stroke-2' />
                                        <span className='text-sm'>Draw</span>
                                    </div>
                                </Button>
                                {/* ---------------------- */}
                                {/* Alignment Origin Map Picking */}
                                {/* ---------------------- */}
                                <Button
                                    type='button'
                                    onClick={handlePickAlignmentOrigin}
                                    className={`w-20 h-15 shadow-sm ${isSelectingPoint
                                        ? 'bg-red-500 hover:bg-red-600'
                                        : 'bg-blue-500 hover:bg-blue-600'
                                        } text-white cursor-pointer`}
                                >
                                    <div className='flex flex-row gap-1 items-center'>
                                        {isSelectingPoint ? (
                                            <X className='h-5 w-5 lg:h-6 lg:w-6 font-bold stroke-6' />
                                        ) : (
                                            <Crosshair className='h-5 w-5 lg:h-6 lg:w-6 stroke-2' />
                                        )}
                                        <span className='text-sm'>
                                            {isSelectingPoint
                                                ? 'Cancel'
                                                : 'Pick'
                                            }
                                        </span>
                                    </div>
                                </Button>
                            </div>
                        </div>
                    </div>
                    {/* --------------------- */}
                    {/* Converted Coordinates */}
                    {/* --------------------- */}
                    {convertedCoord && pageContext.current.epsg !== 4326 &&
                        <div className='bg-white rounded-lg shadow-sm p-4 border border-gray-200 text-black'>
                            <h2 className='text-lg font-semibold mb-2'>
                                Converted Coordinate (EPSG:{pageContext.current.epsg ? pageContext.current.epsg.toString() : ''}
                                )
                            </h2>
                            <div className='flex-1 flex flex-col justify-between'>
                                <div className='flex items-center gap-2 mb-2 '>
                                    <Label className='text-sm font-medium w-1/4'>X</Label>
                                    <div className='w-3/4 p-2 bg-gray-100 rounded border border-gray-300'>
                                        {convertedCoord[0]}
                                    </div>
                                </div>

                                <div className='flex items-center gap-2'>
                                    <Label className='text-sm font-medium w-1/4'>Y</Label>
                                    <div className='w-3/4 p-2 bg-gray-100 rounded border border-gray-300'>
                                        {convertedCoord[1]}
                                    </div>
                                </div>
                            </div>
                        </div>}
                    {/* ----------- */}
                    {/* Grid Layers */}
                    {/* ----------- */}
                    <div className='p-3 bg-white text-black rounded-md shadow-sm border border-gray-200'>
                        <div className='flex justify-between items-center mb-2'>
                            <h3 className='text-lg font-semibold'>{gridLevelText.title}</h3>
                            <Button
                                type='button'
                                className='px-2 py-1 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors text-sm shadow-sm cursor-pointer'
                                onClick={handleAddGridLayer}
                            >
                                <span className='text-lg'>+</span> {gridLevelText.addButton}
                            </Button>
                        </div>
                        {/* ---------- */}
                        {/* Grid Layer */}
                        {/* ---------- */}
                        {pageContext.current.gridLayers.length > 0 ? (
                            <div className='space-y-3'>
                                {pageContext.current.gridLayers.map(layer => (
                                    <div key={layer.id} className='p-2 bg-gray-50 rounded border border-gray-200'>
                                        <div className='flex justify-between items-center mb-2'>
                                            <h4 className='text-sm font-medium'>{gridItemText.level} {layer.id + 1}</h4>
                                            <Button
                                                type='button'
                                                className='px-2 py-0.5 bg-red-100 text-red-700 rounded hover:bg-red-200 text-xs cursor-pointer'
                                                onClick={() => handleRemoveLayer(layer.id)}
                                            >
                                                {gridItemText.remove}
                                            </Button>
                                        </div>
                                        <div className='grid grid-cols-2 gap-2'>
                                            <div>
                                                <label className='block text-xs mb-1'>{gridItemText.width}</label>
                                                <input
                                                    type='number'
                                                    className='w-full px-2 py-1 text-sm border border-gray-300 rounded'
                                                    value={layer.width}
                                                    onChange={(e) => handleUpdateGridSize(layer.id, e.target.value, layer.height)}
                                                    placeholder={gridItemText.widthPlaceholder}
                                                />
                                            </div>
                                            <div>
                                                <label className='block text-xs mb-1'>{gridItemText.height}</label>
                                                <input
                                                    type='number'
                                                    className='w-full px-2 py-1 text-sm border border-gray-300 rounded'
                                                    value={layer.height}
                                                    onChange={(e) => handleUpdateGridSize(layer.id, layer.width, e.target.value)}
                                                    placeholder={gridItemText.heightPlaceholder}
                                                />
                                            </div>
                                        </div>
                                        {layerErrors[layer.id] && (
                                            <div className='mt-2 p-1 bg-red-50 text-red-700 text-xs rounded-md border border-red-200'>
                                                {layerErrors[layer.id]}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className='text-sm text-gray-500 text-center py-2'>
                                {gridLevelText.noLayers}
                            </div>
                        )}
                        {/* ----------------------- */}
                        {/* Grid Layer Adding Rules */}
                        {/* ----------------------- */}
                        {pageContext.current.gridLayers.length > 0 && (
                            <div className='mt-2 p-2 bg-yellow-50 text-yellow-800 text-xs rounded-md border border-yellow-200'>
                                <p>{gridLevelText.rulesTitle}</p>
                                <ul className='list-disc pl-4 mt-1'>
                                    <li>
                                        {gridLevelText.rule1}
                                    </li>
                                    <li>
                                        {gridLevelText.rule2}
                                    </li>
                                    <li>
                                        {gridLevelText.rule3}
                                    </li>
                                </ul>
                            </div>
                        )}
                    </div>
                    {/* --------------- */}
                    {/* General Message */}
                    {/* --------------- */}
                    {generalMessage &&
                        <div
                            className={`p-2 ${bgColor} ${textColor} text-sm rounded-md border ${borderColor}`}
                        >
                            {generalMessage || ''}
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
