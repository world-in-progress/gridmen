import { useEffect, useState } from 'react'
import { MapPin, SquareMousePointer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import GridDisplayPanel from '@/components/gridDisplay/GridDisplayPanel'
import { errorMessage, useGridDisplayTranslation } from '@/i18n/gridDisplay'
import type { IResourceNode } from '../scene/iscene'
import { ResourceNode } from '../scene/scene'
import type { IViewContext } from '@/views/IViewContext'
import { MapViewContext } from '@/views/mapView/mapView'
import { getGridDisplay } from './gridDisplaySession'

type Display = Awaited<ReturnType<typeof getGridDisplay>['promise']>

export default function GridCheck({ node, context }: { node: IResourceNode; context: IViewContext }) {
    const { t } = useGridDisplayTranslation()
    const map = (context as MapViewContext).map!
    const [display, setDisplay] = useState<Display | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [viewError, setViewError] = useState<string | null>(null)
    const [revision, setRevision] = useState(0)

    useEffect(() => {
        let active = true
        setDisplay(null)
        setError(null)
        const session = getGridDisplay(node as ResourceNode, map)
        const updateError = () => { if (active) setViewError(session.error) }
        session.listeners.add(updateError)
        updateError()
        void session.promise.then(result => {
            if (!active) return
            setDisplay(result)
            map.fitBounds(result.boundsOn4326, { padding: 100, duration: 1000 })
        }).catch(cause => { if (active) setError(errorMessage(cause)) })
        return () => {
            active = false
            session.listeners.delete(updateError)
        }
    }, [node, map, revision])

    return <div className='w-full h-full flex flex-col text-white'>
        <div className='flex-none border-b border-gray-700 p-4 space-y-3'>
            <div className='flex justify-center items-center gap-4'>
                <Avatar className='h-10 w-10 border-2 border-white'><AvatarFallback className='bg-[#007ACC]'><SquareMousePointer className='h-6 w-6 text-white' /></AvatarFallback></Avatar>
                <h1 className='font-bold text-[25px]'>{t('gridTitle')}</h1>
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
            {viewError && <p role='alert' className='text-sm text-red-400 break-words'>{t('viewError', { message: viewError })}</p>}
            {display && <>
                <p className='text-sm'>{t('epsg')}: {display.meta.epsg}</p>
                <GridDisplayPanel map={map} layer={display.topologyLayer} attributes={display.meta.attributes}
                    gridInfo={display.meta.grid_info} elevationRange={display.meta.elevationRange} landClasses={display.meta.landClasses} />
            </>}
        </div>
    </div>
}
