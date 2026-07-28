import ar from "./ar.json";
import en from "./en.json";
import es from "./es.json";

// One logical locale catalogue. APPEND new rows. Never reorder the first row:
// it is the unprefixed routing default. Routing/SEO/date metadata lives here,
// never in consumers. Adding a locale = one row here + config entries (§1.2)
// + a `xx.json` with full key parity. Asserted by T1 (parity with the CMS
// PLATFORM_LOCALE_CODES) and T6 (xx.json key parity).
export const LOCALE_CATALOGUE = [
  { code: "ar", rtl: true,  unresolvedFallback: true,  og: "ar_EG", href: "ar-EG", date: "ar-EG" },
  { code: "en", rtl: false, unresolvedFallback: true,  og: "en_US", href: "en-US", date: "en-US" },
  { code: "es", rtl: false, unresolvedFallback: false, og: "es_ES", href: "es-ES", date: "es-ES" },
] as const;

export type Locale = (typeof LOCALE_CATALOGUE)[number]["code"];
export const LOCALES = LOCALE_CATALOGUE.map((row) => row.code) as Locale[];
export const DEFAULT_LOCALE: Locale = LOCALE_CATALOGUE[0].code;
export const UNPREFIXED_LOCALE: Locale = DEFAULT_LOCALE;
export const FALLBACK_LANGUAGES: Locale[] = LOCALE_CATALOGUE
  .filter((row) => row.unresolvedFallback)
  .map((row) => row.code);
export const RTL_LOCALES: ReadonlySet<Locale> = new Set(
  LOCALE_CATALOGUE.filter((row) => row.rtl).map((row) => row.code),
);
export const OG_LOCALE_TAGS = Object.fromEntries(
  LOCALE_CATALOGUE.map((row) => [row.code, row.og]),
) as Record<Locale, string>;
export const HREFLANG_TAGS = Object.fromEntries(
  LOCALE_CATALOGUE.map((row) => [row.code, row.href]),
) as Record<Locale, string>;
export const DATE_LOCALE_TAGS = Object.fromEntries(
  LOCALE_CATALOGUE.map((row) => [row.code, row.date]),
) as Record<Locale, string>;

if (LOCALES.some((code) => !/^[a-z]{2}$/.test(code)))
  throw new Error("Locale codes must be lowercase two-letter ISO-639-1 codes.");
if (!FALLBACK_LANGUAGES.includes(DEFAULT_LOCALE))
  throw new Error("The unresolved fallback set must include the default locale.");

// The import above + this one registration entry are the one sanctioned config
// edit when adding a locale.
const strings: Record<Locale, any> = { ar, en, es };
export const getStrings = (lang: Locale) => strings[lang];
export const isRTL = (lang: Locale) => RTL_LOCALES.has(lang);

// Honor the tenant set; never return a locale outside it (C-10).
export const toLang = (
  v: string | undefined | null,
  supported?: readonly Locale[],
  tenantDefault?: Locale,
): Locale => {
  const l = (v ?? tenantDefault ?? DEFAULT_LOCALE) as Locale;
  if (!LOCALES.includes(l) || (supported && supported.length && !supported.includes(l)))
    return tenantDefault && supported?.includes(tenantDefault)
      ? tenantDefault
      : (supported && supported.length ? supported[0] : DEFAULT_LOCALE);
  return l;
};

// A7-safe: requested → tenantDefault → "". NO unconstrained first-available (BLK-1).
export const pickLocalized = (
  m: Record<string, string> | undefined | null,
  lang: Locale,
  tenantDefault?: Locale,
): string => {
  if (m && typeof m === "object") {
    if (m[lang] != null && m[lang] !== "") return String(m[lang]);
    if (tenantDefault && tenantDefault !== lang && m[tenantDefault] != null && m[tenantDefault] !== "")
      return String(m[tenantDefault]);
  }
  return "";
};

// Payload localized fields arrive as {ar,en,es}; pass the object through as the map.
export const toLocalizedMap = (f: unknown): Record<string, string> =>
  f && typeof f === "object" && !Array.isArray(f)
    ? Object.fromEntries(
        Object.entries(f as Record<string, unknown>)
          .filter(([, v]) => v != null && v !== "")
          .map(([k, v]) => [k, String(v)]),
      )
    : {};

export const localePath = (path: string, lang: Locale): string =>
  lang === UNPREFIXED_LOCALE ? path : `/${lang}${path === "/" ? "/" : path}`;

export const localeFromPath = (pathname: string): Locale => {
  const segment = pathname.split("/")[1];
  return LOCALES.includes(segment as Locale) ? (segment as Locale) : UNPREFIXED_LOCALE;
};

export const stripLocalePrefix = (pathname: string): string => {
  const segment = pathname.split("/")[1];
  if (!LOCALES.includes(segment as Locale)) return pathname;
  return pathname.slice(segment.length + 1) || "/";
};

export const switchLocalePath = (pathname: string, search: string, target: Locale): string =>
  localePath(stripLocalePrefix(pathname), target) + search;

export const languageSwitchLinks = (
  pathname: string,
  search: string,
  languages: readonly Locale[],
) => languages.map((locale) => ({ locale, href: switchLocalePath(pathname, search, locale) }));

// Preserved helper (currently unused across the codebase; retained for compatibility).
// Key type degrades to `any` under the §2.1 `Record<Locale, any>` strings table, which
// keeps compilation stable regardless of per-locale JSON structural drift.
type DeepKey<T> = T extends object
  ? {
      [K in keyof T]: K extends string
        ? T[K] extends object
          ? `${K}` | `${K}.${DeepKey<T[K]>}`
          : `${K}`
        : never;
    }[keyof T]
  : never;

export const t = (lang: Locale, key: DeepKey<typeof strings.en>): string => {
  const parts = key.split(".");
  let current: any = strings[lang];
  for (const part of parts) {
    current = current?.[part];
  }
  return typeof current === "string" ? current : "";
};
