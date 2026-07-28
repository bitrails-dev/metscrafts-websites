// Code-defined locale catalogue. Backs Payload localization.locales + i18n.supportedLanguages AND
// the frontend LOCALES (astro/src/i18n/index.ts). Keep in sync — asserted by T1.
// Adding a locale = APPEND one row here + config entries (§1.2) + frontend `xx.json`. Never reorder
// the first row: it is the platform/unprefixed default. No other code.

export const PLATFORM_LOCALES = [
  { value: 'ar', native: 'العربية', unresolvedFallback: true,  rtl: true,  label: { ar: 'العربية',   en: 'Arabic' },  tenantFieldLabels: { languages: 'اللغات', defaultLanguage: 'اللغة الافتراضية' } },
  { value: 'en', native: 'English', unresolvedFallback: true,  rtl: false, label: { ar: 'الإنجليزية', en: 'English' }, tenantFieldLabels: { languages: 'Languages', defaultLanguage: 'Default language' } },
  { value: 'es', native: 'Español', unresolvedFallback: false, rtl: false, label: { ar: 'الإسبانية',  en: 'Spanish' }, tenantFieldLabels: { languages: 'Idiomas', defaultLanguage: 'Idioma predeterminado' } },
] as const

export type PlatformLocale = (typeof PLATFORM_LOCALES)[number]['value']
export const PLATFORM_LOCALE_CODES = PLATFORM_LOCALES.map((l) => l.value) as PlatformLocale[]
export const PLATFORM_LOCALE_OPTIONS = PLATFORM_LOCALES.map(({ value, label }) => ({ value, label }))
export const DEFAULT_PLATFORM_LOCALE: PlatformLocale = PLATFORM_LOCALES[0].value
export const FALLBACK_PLATFORM_LANGUAGES = PLATFORM_LOCALES.filter((l) => l.unresolvedFallback).map((l) => l.value) as PlatformLocale[]
export const RTL_PLATFORM_LOCALES: ReadonlySet<PlatformLocale> = new Set(PLATFORM_LOCALES.filter((l) => l.rtl).map((l) => l.value))
export const TENANT_LANGUAGE_FIELD_LABELS = {
  languages: Object.fromEntries(PLATFORM_LOCALES.map((l) => [l.value, l.tenantFieldLabels.languages])),
  defaultLanguage: Object.fromEntries(PLATFORM_LOCALES.map((l) => [l.value, l.tenantFieldLabels.defaultLanguage])),
}

if (PLATFORM_LOCALE_CODES.some((code) => !/^[a-z]{2}$/.test(code))) {
  throw new Error('Platform locale codes must be lowercase two-letter ISO-639-1 codes.')
}
if (!FALLBACK_PLATFORM_LANGUAGES.includes(DEFAULT_PLATFORM_LOCALE)) {
  throw new Error('The unresolved fallback set must include the platform default locale.')
}
