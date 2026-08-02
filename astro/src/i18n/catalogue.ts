// Storefront-facing aliases and formatting maps derived from the single platform catalogue.
// The source catalogue is exported by the CMS workspace because Payload and Astro both need it at
// configuration time; tenant records only choose which of these locales are enabled.
import {
  DEFAULT_PLATFORM_LOCALE,
  FALLBACK_PLATFORM_LANGUAGES,
  LOCALE_CATALOGUE as PLATFORM_LOCALE_CATALOGUE,
  PLATFORM_LOCALE_CODES,
  RTL_PLATFORM_LOCALES,
  type PlatformLocale,
} from '@bitrails-works/cms/i18n'

export const LOCALE_CATALOGUE = PLATFORM_LOCALE_CATALOGUE
export type Locale = PlatformLocale
export const LOCALES = PLATFORM_LOCALE_CODES
export const DEFAULT_LOCALE: Locale = DEFAULT_PLATFORM_LOCALE
export const UNPREFIXED_LOCALE: Locale = DEFAULT_LOCALE
export const FALLBACK_LANGUAGES = FALLBACK_PLATFORM_LANGUAGES
export const RTL_LOCALES = RTL_PLATFORM_LOCALES

export const OG_LOCALE_TAGS = Object.fromEntries(
  LOCALE_CATALOGUE.map((locale) => [locale.code, locale.ogTag]),
) as Record<Locale, string>
export const HREFLANG_TAGS = Object.fromEntries(
  LOCALE_CATALOGUE.map((locale) => [locale.code, locale.languageTag]),
) as Record<Locale, string>
export const DATE_LOCALE_TAGS = Object.fromEntries(
  LOCALE_CATALOGUE.map((locale) => [locale.code, locale.languageTag]),
) as Record<Locale, string>
