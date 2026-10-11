import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { resources } from './resources';

export const LOCALE_STORAGE_KEY = 'agboard.locale';
export type Locale = 'en' | 'ja';
export type LocaleStorage = Pick<Storage, 'getItem' | 'setItem'>;
export type LocaleStorageProvider = () => LocaleStorage;

function browserStorage(): Storage {
  return window.localStorage;
}

export function isLocale(value: string | null | undefined): value is Locale {
  return value === 'en' || value === 'ja';
}

export function readLocale(storageProvider: LocaleStorageProvider = browserStorage): Locale {
  try {
    const saved = storageProvider().getItem(LOCALE_STORAGE_KEY);
    return isLocale(saved) ? saved : 'en';
  } catch {
    return 'en';
  }
}

const initialLocale = readLocale();

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLocale,
  fallbackLng: 'en',
  supportedLngs: ['en', 'ja'],
  defaultNS: 'translation',
  initAsync: false,
  interpolation: { escapeValue: false },
  returnNull: false,
});

if (typeof document !== 'undefined') document.documentElement.lang = initialLocale;

export { i18n };

export function initializeLocale(storageProvider: LocaleStorageProvider = browserStorage): Locale {
  const locale = readLocale(storageProvider);
  void i18n.changeLanguage(locale);
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
  return locale;
}

export type LocaleSelectionResult =
  | { locale: Locale; persisted: true }
  | { locale: Locale; persisted: false; error: unknown };

export function selectLocale(
  locale: Locale,
  storageProvider: LocaleStorageProvider = browserStorage,
): LocaleSelectionResult {
  void i18n.changeLanguage(locale);
  if (typeof document !== 'undefined') document.documentElement.lang = locale;

  try {
    storageProvider().setItem(LOCALE_STORAGE_KEY, locale);
    return { locale, persisted: true };
  } catch (error) {
    return { locale, persisted: false, error };
  }
}
