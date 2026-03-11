import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zh from './locales/zh.json';
import en from './locales/en.json';

/** 从 localStorage 读取语言偏好，默认中文 */
const savedLang = localStorage.getItem('webot-lang') ?? 'zh';

i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
  },
  lng: savedLang,
  fallbackLng: 'zh',
  interpolation: {
    escapeValue: false,
  },
});

/** 切换语言并持久化 */
export function changeLanguage(lang: string) {
  i18n.changeLanguage(lang);
  localStorage.setItem('webot-lang', lang);
}

export default i18n;
