import { useTranslation } from 'react-i18next'

export const gridDisplayResources = {
    en: {
        gridTitle: 'Check Grid Cells', patchTitle: 'Check Patch Cells',
        attribute: 'Display attribute', level: 'Level', elevation: 'Elevation (m)', landClass: 'Land class',
        loading: 'Loading grid…', loadingInspection: 'Inspecting cell…',
        loadError: 'Unable to load grid: {{message}}', viewError: 'Unable to load viewport: {{message}}',
        boundsTransformError: 'Unable to transform grid bounds to EPSG:4326',
        patchUnlockError: 'Unable to release patch lock: {{message}}',
        patchLockChanged: 'The patch lock changed while loading. Retry the view.',
        httpError: 'Grid display {{path}}: HTTP {{status}}{{detail}}',
        inspectError: 'Unable to inspect cell: {{message}}', retry: 'Retry', navigate: 'Navigate',
        inspectTip: 'Click the map to inspect an original cell at any scale.',
        checkEnabledTip: 'Enable the checking tool, then click the map to inspect a cell.',
        legend: 'Color legend', levelSize: 'Level {{level}}: {{width}} × {{height}} m',
        landClassLabel: 'Class {{category}}',
        densityHint: 'Darker outlines indicate finer cells.',
        fieldActive: 'Field mode active',
        inspector: 'Original cell', noInspection: 'No cell inspected yet.', noCell: 'No cell at this point.',
        cellId: 'Cell ID', bounds: 'Bounds', deleted: 'Deleted', yes: 'Yes', no: 'No',
        neighbors: 'Original topology neighbors', west: 'West', east: 'East', south: 'South', north: 'North',
        noNeighbors: 'No neighbor', edges: 'Edge IDs', name: 'Name', schema: 'Schema', epsg: 'EPSG',
    },
    zh: {
        gridTitle: '查看网格单元', patchTitle: '查看 Patch 单元',
        attribute: '显示属性', level: '层级', elevation: '高程（m）', landClass: '土地类别',
        loading: '正在加载网格…', loadingInspection: '正在检查单元…',
        loadError: '网格加载失败：{{message}}', viewError: '视口加载失败：{{message}}',
        boundsTransformError: '无法将网格范围转换为 EPSG:4326',
        patchUnlockError: '无法释放 Patch 锁：{{message}}',
        patchLockChanged: '加载期间 Patch 锁发生变化，请重试。',
        httpError: '网格显示 {{path}}：HTTP {{status}}{{detail}}',
        inspectError: '单元检查失败：{{message}}', retry: '重试', navigate: '定位',
        inspectTip: '在任意比例尺下点击地图，查看真实单元。',
        checkEnabledTip: '启用查看工具后，点击地图检查单元。',
        legend: '颜色图例', levelSize: '层级 {{level}}：{{width}} × {{height}} m',
        landClassLabel: '类别 {{category}}',
        densityHint: '边线颜色越深，单元越细。',
        fieldActive: '场模式已启用',
        inspector: '真实单元', noInspection: '尚未检查单元。', noCell: '此处没有单元。',
        cellId: '单元 ID', bounds: '范围', deleted: '已删除', yes: '是', no: '否',
        neighbors: '原始拓扑邻接', west: '西侧', east: '东侧', south: '南侧', north: '北侧',
        noNeighbors: '无邻接单元', edges: '边 ID', name: '名称', schema: 'Schema', epsg: 'EPSG',
    },
}

export function useGridDisplayTranslation() {
    return useTranslation('gridDisplay')
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
