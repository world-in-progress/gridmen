import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { gridDisplayResources } from './gridDisplay'

void i18n.use(initReactI18next).init({
    resources: {
        en: { gridDisplay: gridDisplayResources.en },
        zh: { gridDisplay: gridDisplayResources.zh },
    },
    ns: ['gridDisplay'],
    defaultNS: 'gridDisplay',
    lng: typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en',
    fallbackLng: 'en',
    initImmediate: false,
    interpolation: { escapeValue: false },
})

export default i18n
