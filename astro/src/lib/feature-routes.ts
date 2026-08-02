// Catalogue-derived feature-route gating + locale enforcement (per-tenant-languages §2.7).
//
// This module is PURE (no `astro:middleware` import) so the gating logic is unit-testable
// under `tsx --test` (which cannot resolve Astro virtual modules). `middleware.ts` imports
// and re-exports everything below; the locale-enforcement block there calls
// `computeLocaleRedirect` between tenant-resolve and the healthcare-settings fetch.
import {
  LOCALES,
  UNPREFIXED_LOCALE,
  localeFromPath,
  localePath,
  stripLocalePrefix,
  type Locale,
} from "../i18n";
import type { TenantFeature } from "./tenant";

// Route → capability. A tenant that lacks the capability 404s the whole route subtree.
//
// The WHOLE locale prefix is OPTIONAL (not fixed-width): the `(?:(?:en|es)/)?` group
// requires the locale code to be followed by `/`, so `/endepartments`-style concatenations
// do NOT match (T8). Covers the unprefixed default locale implicitly (empty prefix).
export const buildFeatureRoutes = (
  locales: readonly Locale[],
  unprefixed: Locale,
): Array<[RegExp, TenantFeature]> => {
  const prefixed = locales.filter((locale) => locale !== unprefixed);
  const optionalPrefix = prefixed.length ? `(?:(?:${prefixed.join("|")})/)?` : "";
  const route = (body: string) => new RegExp(`^/${optionalPrefix}${body}(?:/|$)`);
  return [
    [route("departments"), "departments"],
    [route("team"), "team"],
    [route("doctors"), "team"],
    [route("articles"), "articles"],
    [route("events"), "events"],
    [route("awards"), "awards"],
    [route("achievements"), "achievements"],
    [route("testimonials"), "testimonials"],
    [route("portal"), "portal"],
    // Commerce storefront (shop, cart, checkout, account) + its same-origin BFF. Pages gate
    // on the `commerce` feature; /api/store/* checks storeTenantSlug() itself (not matched).
    [route("(?:shop|cart|checkout|account)"), "commerce"],
  ];
};

export const FEATURE_ROUTES: Array<[RegExp, TenantFeature]> = buildFeatureRoutes(
  LOCALES,
  UNPREFIXED_LOCALE,
);

// --- Non-content paths bypass locale enforcement (T15) ---
// Public-root files (exact match) + dashboard/API/media/static-asset prefixes. A path is
// non-content if it equals one of these or sits beneath it (`/uploads/x.jpg`); a path that
// merely starts with the same characters (`/uploadsX`) is treated as content.
const NON_CONTENT_EXACT = new Set([
  "/favicon.svg",
  "/icon.png",
  "/robots.txt",
  "/site.webmanifest",
]);
const NON_CONTENT_PREFIXES = [
  "/admin",
  "/api",
  "/_next",
  "/_astro",
  "/_image",
  "/uploads",
  "/logo",
  "/images",
];

export const isContentPath = (p: string): boolean =>
  !NON_CONTENT_EXACT.has(p) &&
  !NON_CONTENT_PREFIXES.some((pre) => p === pre || p.startsWith(pre + "/"));

// Reject locale-shaped prefixes that are not in the platform catalogue. Without this guard,
// Astro's `[...lang]` routes accept values such as `fr/about`; redirecting that path to a tenant
// default produces `/es/fr/about`, which the catch-all route then renders as a duplicate page.
export const hasUnknownLocalePrefix = (path: string): boolean => {
  if (!isContentPath(path)) return false;
  const segment = path.split("/")[1];
  return /^[a-z]{2}$/i.test(segment) && !LOCALES.includes(segment.toLowerCase() as Locale);
};

// Locale enforcement (§2.7). When a tenant carries a non-empty languages set, any content
// path whose requested locale is outside that set redirects to the tenant default locale.
// `search` is appended verbatim so querystrings survive the redirect (BLK-4). The default
// resolves to `defaultLanguage` when it is in `languages`, else `languages[0]`. Returns the
// redirect URL (path + search) or `null` when no redirect is required.
export const computeLocaleRedirect = (
  path: string,
  search: string,
  languages: readonly Locale[],
  defaultLanguage: Locale,
): string | null => {
  if (!languages.length) return null;
  if (!isContentPath(path)) return null;
  const requested = localeFromPath(path);
  const def = languages.includes(defaultLanguage) ? defaultLanguage : languages[0];
  if (!languages.includes(requested)) {
    return localePath(stripLocalePrefix(path), def) + search;
  }
  return null;
};
