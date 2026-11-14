import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { gridDisplayResources } from './gridDisplay'
import { gridCreationResources } from './gridCreation'

void i18n.use(initReactI18next).init({
    resources: {
        en: { gridDisplay: gridDisplayResources.en, gridCreation: gridCreationResources.en },
        zh: { gridDisplay: gridDisplayResources.zh, gridCreation: gridCreationResources.zh },
    },
    ns: ['gridDisplay', 'gridCreation'],
    defaultNS: 'gridDisplay',
    lng: typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en',
    fallbackLng: 'en',
    initImmediate: false,
    interpolation: { escapeValue: false },
})

export default i18n
