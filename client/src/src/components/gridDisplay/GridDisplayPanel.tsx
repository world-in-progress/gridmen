import { useEffect, useState } from 'react'
import type { Map as MapboxMap } from 'mapbox-gl'
import type { DisplayAttribute, GridDisplayMeta } from '@/core/grid/displayTypes'
import { ELEVATION_LOW_COLOR, ELEVATION_HIGH_COLOR, OUTLINE_DARKENING, elevationColor } from '@/core/grid/displayColors'
import type TopologyLayer from '@/views/mapView/topology/TopologyLayer'
import { useGridDisplayTranslation } from '@/i18n/gridDisplay'
import GridInspector from './GridInspector'
import { useGridInspection } from './useGridInspection'

interface Props {
    map: MapboxMap
    layer: TopologyLayer
    attributes: DisplayAttribute[]
    gridInfo: GridDisplayMeta['grid_info']
    elevationRange?: GridDisplayMeta['elevationRange']
    landClasses?: GridDisplayMeta['landClasses']
    inspectEnabled?: boolean
}

function paletteColor(layer: TopologyLayer, index: number) {
    const offset = ((index % 256) + 256) % 256 * 3
    return `rgb(${layer.paletteColorList[offset]}, ${layer.paletteColorList[offset + 1]}, ${layer.paletteColorList[offset + 2]})`
}

function normalizedColor(color: readonly [number, number, number]) {
    return `rgb(${color.map(channel => channel * 255).join(', ')})`
}

function elevationGradient(range: GridDisplayMeta['elevationRange']) {
    const middle = elevationColor(range[0] / 2 + range[1] / 2, range)
    const high = range[0] === range[1] ? ELEVATION_LOW_COLOR : ELEVATION_HIGH_COLOR
    return `linear-gradient(to right, ${normalizedColor(ELEVATION_LOW_COLOR)}, ${normalizedColor(middle)}, ${normalizedColor(high)})`
}

export default function GridDisplayPanel({ map, layer, attributes, gridInfo, elevationRange, landClasses, inspectEnabled = true }: Props) {
    const { t } = useGridDisplayTranslation()
    const [attribute, setAttribute] = useState<DisplayAttribute>(layer.attribute)
    const [stats, setStats] = useState(() => layer.getDisplayStats())
    const inspection = useGridInspection(map, layer, inspectEnabled)

    useEffect(() => {
        let previous: ReturnType<TopologyLayer['getDisplayStats']> | null = null
        const update = () => {
            const next = { ...layer.getDisplayStats() }
            if (previous && previous.gpuBytes === next.gpuBytes && previous.visibleChunks === next.visibleChunks &&
                previous.visibleCells === next.visibleCells && previous.fieldSamples === next.fieldSamples &&
                previous.fieldMode === next.fieldMode && previous.ready === next.ready) return
            previous = next
            setStats(next)
        }
        update()
        return layer.addDisplayStatsListener(update)
    }, [layer])

    const changeAttribute = (next: DisplayAttribute) => {
        layer.attribute = next
        setAttribute(next)
        map.triggerRepaint()
    }

    return <div className='space-y-4 text-sm text-white'>
        <label className='flex flex-col gap-1'>
            <span className='font-semibold'>{t('attribute')}</span>
            <select className='border border-gray-600 rounded-sm bg-gray-700 px-2 py-1' value={attribute}
                onChange={event => changeAttribute(event.target.value as DisplayAttribute)}>
                {attributes.map(value => <option key={value} value={value}>{t(value)}</option>)}
            </select>
        </label>
        {attribute === 'level' && <section className='space-y-2'>
            <h2 className='font-bold text-base'>{t('legend')} · {t(attribute)}</h2>
            <ul className='space-y-1'>{gridInfo.map(([width, height], index) => <li key={index} className='flex gap-2 items-center'>
                <span className='w-3 h-3 shrink-0 border border-gray-500' style={{ backgroundColor: paletteColor(layer, index + 1) }} />
                {t('levelSize', { level: index + 1, width, height })}
            </li>)}</ul>
        </section>}
        {attribute === 'elevation' && elevationRange && <section className='space-y-2'>
            <h2 className='font-bold text-base'>{t('legend')} · {t('elevation')}</h2>
            <div className='h-3 border border-gray-500' aria-hidden='true' style={{ background: elevationGradient(elevationRange) }} />
            <div className='flex justify-between'><span>{elevationRange[0]}</span><span>{elevationRange[1]}</span></div>
        </section>}
        {attribute === 'landClass' && landClasses && <section className='space-y-2'>
            <h2 className='font-bold text-base'>{t('legend')} · {t('landClass')}</h2>
            <ul className='space-y-1'>{landClasses.map(category => <li key={category} className='flex gap-2 items-center'>
                <span className='w-3 h-3 shrink-0 border border-gray-500' style={{ backgroundColor: paletteColor(layer, category) }} />
                {t('landClassLabel', { category })}
            </li>)}</ul>
        </section>}
        <section className='space-y-1'>
            <h2 className='font-bold text-base'>{t('density')}</h2>
            <div className='h-3 bg-white flex' aria-hidden='true'>{[0.25, 0.5, 1].map(coverage => {
                const channel = 1 - OUTLINE_DARKENING * coverage
                return <span key={coverage} className='flex-1' style={{ backgroundColor: normalizedColor([channel, channel, channel]) }} />
            })}</div>
            <div className='flex justify-between text-xs'><span>0.25</span><span>0.5</span><span>1</span></div>
            <p>{t('densityHint')}</p><p className='text-xs text-gray-300'>{t('densityFormula')}</p><p className='text-xs text-gray-300'>{t('densityThreshold')}</p>
        </section>
        <section className='space-y-1' aria-live='polite'>
            <p className='font-semibold'>{t(!stats.ready ? 'preparing' : stats.fieldMode ? 'fieldActive' : 'cellActive')}</p>
            <dl className='grid grid-cols-2 gap-x-2 gap-y-1'>
                <dt>{t('visibleCells')}</dt><dd>{stats.visibleCells.toLocaleString()}</dd>
                <dt>{t('fieldSamples')}</dt><dd>{stats.fieldSamples.toLocaleString()}</dd>
                <dt>{t('visibleChunks')}</dt><dd>{stats.visibleChunks.toLocaleString()}</dd>
                <dt>{t('gpuBytes')}</dt><dd>{stats.gpuBytes.toLocaleString()}</dd>
            </dl>
        </section>
        <p className='text-gray-300'>{t(inspectEnabled ? 'inspectTip' : 'checkEnabledTip')}</p>
        {inspection.loading && <p role='status'>{t('loadingInspection')}</p>}
        {inspection.error && <p role='alert' className='text-red-400 break-words'>{t('inspectError', { message: inspection.error })}</p>}
        {!inspection.loading && !inspection.error && <GridInspector inspection={inspection.inspection} attributes={attributes} />}
    </div>
}
