import React from 'react'
import { IViewContext } from '@/views/IViewContext'
import { MapViewContext } from '@/views/mapView/mapView'

interface SchemaCheckProps {
    context: IViewContext
}

export default function SchemaCheck({ context }: SchemaCheckProps) {
    const mapContext = context as MapViewContext
    const map = mapContext.map

    return (
        <div className="p-4 text-white">
            <div>SchemaCheck</div>
            <div className="mt-2 text-sm text-gray-400">
                mapInstance: {map ? 'loaded' : 'not loaded'}
            </div>
        </div>
    )
}
