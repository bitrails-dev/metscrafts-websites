import { messages } from "./messages";
import {
  DEFAULT_LOCALE,
  FALLBACK_LANGUAGES,
  LOCALES,
  RTL_LOCALES,
  UNPREFIXED_LOCALE,
  type Locale,
} from "./catalogue";

export * from "./catalogue";

// The import above + this one registration entry are the one sanctioned config
// edit when adding a locale.
const strings: Record<Locale, any> = messages;
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
