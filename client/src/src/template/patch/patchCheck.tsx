import { useEffect, useState } from 'react'
import { MapPin, SquareMousePointer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import GridDisplayPanel from '@/components/gridDisplay/GridDisplayPanel'
import { getPatchDisplay } from '@/components/gridDisplay/patchDisplaySession'
import { errorMessage, useGridDisplayTranslation } from '@/i18n/gridDisplay'
import type { IViewContext } from '@/views/IViewContext'
import { MapViewContext } from '@/views/mapView/mapView'
import type { IResourceNode } from '../scene/iscene'
import { ResourceNode } from '../scene/scene'

type Display = Awaited<ReturnType<typeof getPatchDisplay>>

export default function PatchCheck({ node, context }: { node: IResourceNode; context: IViewContext }) {
    const { t } = useGridDisplayTranslation()
    const map = (context as MapViewContext).map!
    const [display, setDisplay] = useState<Display | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [revision, setRevision] = useState(0)

    useEffect(() => {
        let active = true
        setDisplay(null)
        setError(null)
        void getPatchDisplay(node as ResourceNode, map, 'r').then(result => {
            if (!active) return
            setDisplay(result)
            map.fitBounds(result.boundsOn4326, { padding: 100, duration: 1000 })
        }).catch(cause => { if (active) setError(errorMessage(cause)) })
        return () => { active = false }
    }, [node, map, revision])

    return <div className='w-full h-full flex flex-col text-white'>
        <div className='flex-none border-b border-gray-700 p-4 space-y-3'>
            <div className='flex justify-center items-center gap-4'>
                <Avatar className='h-10 w-10 border-2 border-white'><AvatarFallback className='bg-[#007ACC]'><SquareMousePointer className='h-6 w-6 text-white' /></AvatarFallback></Avatar>
                <h1 className='font-bold text-[25px]'>{t('patchTitle')}</h1>
            </div>
            <p className='text-sm break-words'>{t('name')}: {node.name}</p>
            {display && <Button className='bg-sky-500 hover:bg-sky-600 h-8 text-white rounded-sm cursor-pointer'
                onClick={() => map.fitBounds(display.boundsOn4326, { padding: 100, duration: 1000 })}>
                <MapPin className='w-4 h-4' />{t('navigate')}
            </Button>}
        </div>
        <div className='flex-1 overflow-y-auto min-h-0 p-4 space-y-3'>
            {error ? <div role='alert' className='text-sm text-red-400 break-words'>
                <p>{t('loadError', { message: error })}</p><Button variant='outline' onClick={() => setRevision(value => value + 1)}>{t('retry')}</Button>
            </div> : !display && <p role='status'>{t('loading')}</p>}
            {display && <>
                <dl className='text-sm grid grid-cols-2 gap-1'>
                    <dt>{t('schema')}</dt><dd>{display.patch.schema_node_key.split('.').pop()}</dd>
                    <dt>{t('epsg')}</dt><dd>{display.patch.epsg}</dd>
                    <dt>{t('bounds')}</dt><dd className='break-words'>{display.patch.bounds.join(', ')}</dd>
                </dl>
                <GridDisplayPanel map={map} layer={display.topologyLayer} attributes={['level']} gridInfo={display.patch.grid_info} />
            </>}
        </div>
    </div>
}
