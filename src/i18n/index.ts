import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import ja from './locales/ja/common.json'
import en from './locales/en/common.json'

let language = 'ja'
try { const saved = localStorage.getItem('co-make:language'); if (saved === 'ja' || saved === 'en') language = saved } catch { /* Use Japanese when storage is unavailable. */ }

void i18n.use(initReactI18next).init({
  resources: { ja: { common: ja }, en: { common: en } },
  lng: language,
  fallbackLng: 'en',
  defaultNS: 'common',
  interpolation: { escapeValue: false },
})

i18n.on('languageChanged', (language) => { document.documentElement.lang = language })
document.documentElement.lang = language
export default i18n
