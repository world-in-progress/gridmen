import type { DisplayAttribute, DisplayCell, GridInspection } from '@/core/grid/displayTypes'
import { useGridDisplayTranslation } from '@/i18n/gridDisplay'

export default function GridInspector({ inspection, attributes }: {
    inspection: GridInspection | null
    attributes: DisplayAttribute[]
}) {
    const { t } = useGridDisplayTranslation()
    const cellValues = (cell: DisplayCell) => (
        <dl className='grid grid-cols-2 gap-x-2 gap-y-1 break-words'>
            <dt>{t('cellId')}</dt><dd>{cell.id}</dd>
            {attributes.map(attribute => <div key={attribute} className='contents'>
                <dt>{t(attribute)}</dt><dd>{cell[attribute]}</dd>
            </div>)}
            <dt>{t('bounds')}</dt><dd>{cell.bounds.join(', ')}</dd>
            {cell.deleted !== undefined && <><dt>{t('deleted')}</dt><dd>{t(cell.deleted ? 'yes' : 'no')}</dd></>}
        </dl>
    )
    return <section className='space-y-2'>
        <h2 className='font-bold text-base'>{t('inspector')}</h2>
        {!inspection ? <p>{t('noInspection')}</p> : !inspection.cell ? <p>{t('noCell')}</p> : <>
            {cellValues(inspection.cell)}
            <h3 className='font-semibold pt-2'>{t('neighbors')}</h3>
            {(['west', 'east', 'south', 'north'] as const).map(side => {
                const neighbors = inspection.neighbors.filter(neighbor => neighbor.side === side)
                return <section key={side} className='border-t border-gray-700 pt-2 space-y-2'>
                    <h4 className='font-semibold'>{t(side)}</h4>
                    {neighbors.length === 0 ? <p className='text-gray-300'>{t('noNeighbors')}</p> :
                        <ul className='space-y-2'>{neighbors.map(neighbor => <li key={`${neighbor.cell.id}:${neighbor.edgeIds.join(',')}`}>
                            {cellValues(neighbor.cell)}
                            <p className='break-words'>{t('edges')}: {neighbor.edgeIds.join(', ')}</p>
                        </li>)}</ul>}
                </section>
            })}
        </>}
    </section>
}
