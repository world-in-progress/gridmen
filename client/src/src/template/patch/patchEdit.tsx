import React from 'react'
import { IViewContext } from '@/views/IViewContext'
import { MapViewContext } from '@/views/mapView/mapView'
import { IResourceNode } from '../scene/iscene'

interface PatchEditProps {
    node: IResourceNode
    context: IViewContext
}

export default function PatchEdit({ node, context }: PatchEditProps) {
    const mapContext = context as MapViewContext
    const map = mapContext.map

    return (
        <div className="p-4 text-white">
            <div>PatchEdit</div>
            <div className="mt-2 text-sm text-gray-400">
                mapInstance: {map ? 'loaded' : 'not loaded'}
            </div>
        </div>
    )
}
