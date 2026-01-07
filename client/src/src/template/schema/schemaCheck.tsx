import React, { useEffect, useReducer } from 'react'
import { IViewContext } from '@/views/IViewContext'
import { MapViewContext } from '@/views/mapView/mapView'
import { IResourceNode } from '../scene/iscene'
import { addMapMarker } from '@/utils/utils'
import { ResourceNode } from '../scene/scene'
import * as api from '@/template/noodle/apis'
import { SchemaData } from './types'

interface SchemaCheckProps {
    node: IResourceNode
    context: IViewContext
}

export default function SchemaCheck({ node, context }: SchemaCheckProps) {
    const mapContext = context as MapViewContext
    const map = mapContext.map!

    const [, triggerRepaint] = useReducer(x => x + 1, 0)

    useEffect(() => {
        loadContext()

        return () => {
            unloadContext()
        }
    }, [])

    const loadContext = async () => {
        if ((node as ResourceNode).mountParams === undefined) {
            const schemaNode = await api.node.getNodeMountParams(node.key, (node as ResourceNode).tree.leadIP !== undefined ? true : false)

            const { template_name, mount_params } = schemaNode

            const schemaData = JSON.parse(mount_params) as SchemaData

            (node as ResourceNode).mountParams = schemaData

            addMapMarker(map, schemaData.alignment_origin, node.key)
        }


        triggerRepaint()
    }


    const unloadContext = () => {

    }

    return (
        <div className="p-4 text-white">
            <div>SchemaCheck</div>
            <div className="mt-2 text-sm text-gray-400">
                mapInstance: {map ? 'loaded' : 'not loaded'}
            </div>
        </div>
    )
}
