// Compatibility facade for collection/access consumers. The canonical metadata now lives in
// ../i18n/catalogue so Payload and Astro cannot drift as locales are added.
import {
  DEFAULT_PLATFORM_LOCALE,
  FALLBACK_PLATFORM_LANGUAGES,
  LOCALE_CATALOGUE,
  PLATFORM_LOCALE_CODES,
  RTL_PLATFORM_LOCALES,
  type PlatformLocale,
} from '../i18n/catalogue'

export {
  DEFAULT_PLATFORM_LOCALE,
  FALLBACK_PLATFORM_LANGUAGES,
  PLATFORM_LOCALE_CODES,
  RTL_PLATFORM_LOCALES,
  type PlatformLocale,
}

export const PLATFORM_LOCALES = LOCALE_CATALOGUE.map((locale) => ({
  value: locale.code,
  native: locale.nativeName,
  unresolvedFallback: locale.unresolvedFallback,
  rtl: locale.direction === 'rtl',
  label: locale.adminLabel,
  tenantFieldLabels: locale.tenantFieldLabels,
}))

export const PLATFORM_LOCALE_OPTIONS = LOCALE_CATALOGUE.map((locale) => ({
  value: locale.code,
  label: locale.adminLabel,
}))

export const TENANT_LANGUAGE_FIELD_LABELS = {
  languages: Object.fromEntries(
    LOCALE_CATALOGUE.map((locale) => [locale.code, locale.tenantFieldLabels.languages]),
  ),
  defaultLanguage: Object.fromEntries(
    LOCALE_CATALOGUE.map((locale) => [locale.code, locale.tenantFieldLabels.defaultLanguage]),
  ),
}
