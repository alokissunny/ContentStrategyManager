import { useSyncExternalStore } from 'react';
import spanish from './locales/es.json';

export const LOCALES = [{ id: 'en', label: 'English', intl: 'en-US' }, { id: 'es', label: 'Español', intl: 'es-ES' }];
const catalogs = { en: {}, es: spanish };
const KEY = 'bauhly.locale';
const valid = value => LOCALES.some(locale => locale.id === value) ? value : 'en';
const read = () => { try { return valid(localStorage.getItem(KEY)); } catch { return 'en'; } };
let locale = read();
const listeners = new Set();
function apply() {
  if (typeof document !== 'undefined') { document.documentElement.lang = locale; document.documentElement.dir = 'ltr'; }
  listeners.forEach(listener => listener());
}
export function setLocale(next) {
  locale = valid(next);
  try { localStorage.setItem(KEY, locale); } catch { /* session preference still works */ }
  apply();
}
export function getLocale() { return locale; }
export function intlLocale() { return LOCALES.find(item => item.id === locale).intl; }
export function useLocale() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, getLocale, () => 'en');
}
export function translate(value, params = {}) {
  if (typeof value !== 'string') return value;
  const key = value.trim().replace(/\s+/g, ' ');
  const translated = catalogs[locale]?.[key];
  const text = translated ? value.replace(/\S[\s\S]*\S|\S/, () => translated) : value;
  return text.replace(/\{\{(\w+)\}\}/g, (match, name) => Object.hasOwn(params, name) ? String(params[name] ?? '') : match);
}
if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => { if (event.key === KEY || event.key === null) { locale = read(); apply(); } });
  apply();
}
