import { useTranslation } from 'react-i18next'

export const gridCreationResources = {
    en: {
        preserveLulc: 'Preserve LULC',
        preserveLulcTip: 'Cells and edges whose current LULC class is listed are left unchanged by this intervention.',
        preserveLulcPlaceholder: 'Classes, e.g. 8, 5',
        preserveLulcInvalid: '{{name}}: enter unique LULC integers from 0 to 255, separated by commas.',
    },
    zh: {
        preserveLulc: '保留 LULC',
        preserveLulcTip: '当前 LULC 类别在列表里的单元与边不受这项干预改写。',
        preserveLulcPlaceholder: '类别，如 8, 5',
        preserveLulcInvalid: '{{name}}：请输入逗号分隔的 0–255 整数类别，至少一项且不能重复。',
    },
}

export function useGridCreationTranslation() {
    return useTranslation('gridCreation')
}
