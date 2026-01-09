import React, { useEffect, useReducer } from 'react'
import { IViewContext } from '@/views/IViewContext'
import { MapViewContext } from '@/views/mapView/mapView'
import { IResourceNode } from '../scene/iscene'
import { ResourceNode } from '../scene/scene'
import { SchemaData } from './types'
import * as api from '@/template/noodle/apis'
import { addMapMarker, clearMarkerByNodeKey } from '@/utils/utils'

interface SchemaEditProps {
    node: IResourceNode
    context: IViewContext
}

export default function SchemaEdit({ node, context }: SchemaEditProps) {
    const mapContext = context as MapViewContext
    const map = mapContext.map!

    const [, triggerRepaint] = useReducer(x => x + 1, 0)

    useEffect(() => {
        loadContext()

        return () => unloadContext()
    }, [])

    const loadContext = async () => {
        const resourceNode = node as ResourceNode

        // Normalize mount params into SchemaData regardless of who set mountParams.
        let schemaData: SchemaData | null = null
        const existing = resourceNode.mountParams as any

        if (!existing) {
            const schemaNode = await api.node.getNodeParams(node.key, resourceNode.tree.leadIP !== undefined ? true : false)
            const parsed = JSON.parse(schemaNode.mount_params) as SchemaData
            resourceNode.mountParams = parsed
            schemaData = parsed
        } else if (typeof existing === 'object' && typeof existing.mount_params === 'string') {
            // Some callers store the raw response from getNodeParams.
            schemaData = JSON.parse(existing.mount_params) as SchemaData
            resourceNode.mountParams = schemaData
        } else {
            // Assume it's already SchemaData-compatible.
            schemaData = existing as SchemaData
        }

        if (schemaData) {
            addMapMarker(map, schemaData.alignment_origin, node.key, { color: 'red' })

            // Register cleanup so layer.node?.close() can clear drawings.
            resourceNode.context = {
                ...(resourceNode.context ?? {}),
                __cleanup: {
                    ...((resourceNode.context as any)?.__cleanup ?? {}),
                    marker: () => clearMarkerByNodeKey(node.key),
                },
            }
        }

        triggerRepaint()
    }


    const unloadContext = () => {
        // cleanup is handled by node.close() when the layer is removed
    }

    return (
        <div className="p-4 text-white">
            <div>SchemaEdit</div>
            <div className="mt-2 text-sm text-gray-400">
                mapInstance: {map ? 'loaded' : 'not loaded'}
            </div>
        </div>
    )
}
