// Platform locale metadata shared by Payload and the Astro storefront. This is deliberately
// code-defined: both frameworks need the supported locale set while their configs are booting.
// Tenant records select a subset from this catalogue; user-facing message bundles live as JSON
// under astro/src/i18n/messages.
//
// Adding a locale is one row here, one matching JSON message file, and registry entries for the
// storefront messages and Payload's admin translation module. Append only: the first row is the
// platform default and Astro's unprefixed locale.
export const LOCALE_CATALOGUE = [
  {
    code: 'ar',
    nativeName: 'العربية',
    direction: 'rtl',
    languageTag: 'ar-EG',
    ogTag: 'ar_EG',
    unresolvedFallback: true,
    adminLabel: { ar: 'العربية', en: 'Arabic' },
    tenantFieldLabels: { languages: 'اللغات', defaultLanguage: 'اللغة الافتراضية' },
  },
  {
    code: 'en',
    nativeName: 'English',
    direction: 'ltr',
    languageTag: 'en-US',
    ogTag: 'en_US',
    unresolvedFallback: true,
    adminLabel: { ar: 'الإنجليزية', en: 'English' },
    tenantFieldLabels: { languages: 'Languages', defaultLanguage: 'Default language' },
  },
  {
    code: 'es',
    nativeName: 'Español',
    direction: 'ltr',
    languageTag: 'es-ES',
    ogTag: 'es_ES',
    unresolvedFallback: false,
    adminLabel: { ar: 'الإسبانية', en: 'Spanish' },
    tenantFieldLabels: { languages: 'Idiomas', defaultLanguage: 'Idioma predeterminado' },
  },
] as const

export type PlatformLocale = (typeof LOCALE_CATALOGUE)[number]['code']

export const PLATFORM_LOCALE_CODES = LOCALE_CATALOGUE.map((locale) => locale.code) as PlatformLocale[]
export const DEFAULT_PLATFORM_LOCALE: PlatformLocale = LOCALE_CATALOGUE[0].code
export const FALLBACK_PLATFORM_LANGUAGES = LOCALE_CATALOGUE
  .filter((locale) => locale.unresolvedFallback)
  .map((locale) => locale.code) as PlatformLocale[]
export const RTL_PLATFORM_LOCALES: ReadonlySet<PlatformLocale> = new Set(
  LOCALE_CATALOGUE.filter((locale) => locale.direction === 'rtl').map((locale) => locale.code),
)

if (PLATFORM_LOCALE_CODES.some((code) => !/^[a-z]{2}$/.test(code))) {
  throw new Error('Platform locale codes must be lowercase two-letter ISO-639-1 codes.')
}
if (!FALLBACK_PLATFORM_LANGUAGES.includes(DEFAULT_PLATFORM_LOCALE)) {
  throw new Error('The unresolved fallback set must include the platform default locale.')
}
