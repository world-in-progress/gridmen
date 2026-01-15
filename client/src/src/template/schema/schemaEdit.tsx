import { useEffect, useReducer } from 'react'
import { IViewContext } from '@/views/IViewContext'
import { MapViewContext } from '@/views/mapView/mapView'
import { IResourceNode } from '../scene/iscene'
import { ResourceNode } from '../scene/scene'
import { SchemaData } from './types'
import * as api from '@/template/api/apis'
import { addMapMarker, clearMarkerByNodeKey, convertPointCoordinate } from '@/utils/utils'
import { linkNode } from '../api/node'

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
        // if (!(node as ResourceNode).lockId) {
        //     const linkResponse = await linkNode('cc/ISchema/0.1.0', node.key, 'r', (node as ResourceNode).tree.leadIP !== undefined ? true : false);
        //     (node as ResourceNode).lockId = linkResponse.lock_id
        // }

        if ((node as ResourceNode).mountParams === undefined) {
            const schemaNode = await api.node.getNodeParams(node.nodeInfo)
            const parsed = JSON.parse((schemaNode as unknown as any).mount_params) as SchemaData
            (node as ResourceNode).mountParams = parsed

            const alignmentOriginOn4326 = await convertPointCoordinate(parsed.alignment_origin, parsed.epsg, 4326)
            addMapMarker(map, alignmentOriginOn4326!, node.key, { color: 'red' })
        } else {
            const alignmentOriginOn4326 = await convertPointCoordinate((node as ResourceNode).mountParams.alignment_origin, (node as ResourceNode).mountParams.epsg, 4326)
            addMapMarker(map, alignmentOriginOn4326!, node.key, { color: 'red' })
        }

        (node as ResourceNode).context = {
            ...((node as ResourceNode).context ?? {}),
            __cleanup: {
                ...(((node as ResourceNode).context as any)?.__cleanup ?? {}),
                marker: () => clearMarkerByNodeKey(node.key),
            },
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
