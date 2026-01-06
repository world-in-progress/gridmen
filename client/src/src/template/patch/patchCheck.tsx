import React from 'react'
import { IViewContext } from '@/views/IViewContext'
import { MapViewContext } from '@/views/mapView/mapView'

interface PatchCheckProps {
    context: IViewContext
}

export default function PatchCheck({ context }: PatchCheckProps) {
    const mapContext = context as MapViewContext
    const map = mapContext.map

    return (
        <div className="p-4 text-white">
            <div>PatchCheck</div>
            <div className="mt-2 text-sm text-gray-400">
                mapInstance: {map ? 'loaded' : 'not loaded'}
            </div>
        </div>
    )
}
