# Per-tenant language support

**Status:** REV 4 — final correctness/safety remediation; mechanically executable. **Date:** 2026-07-28.
**Owner agent:** mechanical implementer. Read §0, §0.5, §9 (tests), §10 (migration safety), §11 (verify gate), §12 (do-not) before writing code. §14 maps every review finding (REV 1 through the final REV 3.1 audit) to its fix.

> **Design principle (the whole plan reduces to this):** there is exactly **one logical locale catalogue**, represented by the parity-locked CMS and frontend catalogue tables in §1.1/§2.1. A locale code may appear only (a) inside those catalogue tables, (b) as the value assigned to the named platform constants `DEFAULT_PLATFORM_LOCALE` / `DEFAULT_LOCALE` / `UNPREFIXED_LOCALE` and `FALLBACK_PLATFORM_LANGUAGES` / `FALLBACK_LANGUAGES`, (c) in the one static Payload admin-language import/registration entry required by `i18n.supportedLanguages`, or (d) in migration SQL. Tests may reference catalogue exports but must not redeclare codes. Everything else derives from the catalogue/constants. Adding a language = one catalogue row in each parity-locked package + one Payload admin-language import/registration entry + one `xx.json`; no route, component, mapper, middleware, or test edit.
>
> **Exception, explicitly allowed:** migration SQL (`'ar'`, `'en'`) is literal by necessity — SQL cannot import TS constants. These literals are migration-owned data, not locale hardcoding.

---

## 0. Assumptions (REV 4)

| # | Decision | Choice |
|---|----------|--------|
| A1 | Path A — union of locales in one global Payload `localization.locales`; per-tenant visibility at the app layer. Path B rejected. | Path A |
| A2 | Routing A1 — `/` stays the unprefixed locale (`UNPREFIXED_LOCALE`); tenants whose default ≠ it redirect `/` → `/<default>`. Astro routing is only extended, not restructured. | A1 |
| A3 | Dashboard = (a) admin **interface** language packs (`i18n.supportedLanguages`, per-user) **and** (b) per-tenant **content-locale scoping** via a server-side strip hook. The UI tab-hiding variant is **infeasible** in current Payload (§3, C-6) and is dropped. | both, server-only |
| A4 | Catalogue-driven, any list. Launch catalogue `ar, en, es`. No hard requirement for any specific language. | catalogue |
| A5 | `languages` / `defaultLanguage` are platform-managed (super-admin only). | platform |
| A6 | All in-repo frontend surfaces in scope. Only the **external portal backend** (`PUBLIC_PORTAL_API_BASE`, separate repo) is excluded. | full frontend |
| A7 | Localized fallback = the tenant's `defaultLanguage`, **never** a global `ar`. A non-ar tenant must never render Arabic. `pickLocalized` has **no unconstrained first-available step** (BLK-1). | tenant default |
| A8 | Hard prerequisite — `modular-vertical-settings` lands (committed, **with its `.json` migration snapshots**) first. §0.5. | sequenced |
| A9 | Locale codes are lowercase two-letter ISO-639-1 codes (`/^[a-z]{2}$/`). This prevents collisions with current route names and is asserted by T1. | two-letter |

**Non-goals:** Path B; routing A2; `@payloadcms/ui` per-tenant field-locale tab hiding; auto-translation; the external portal backend.

---

## 0.5 Prerequisite — `modular-vertical-settings` (coordination contract)

`docs/superpowers/plans/2026-07-27-modular-vertical-settings.md` is **implemented but uncommitted** in the current tree. It MUST be committed — **including the missing `.json` migration snapshots** for `20260727_130000_add_and_backfill_healthcare_settings` and `20260727_130100_drop_healthcare_fields_from_tenants` (currently absent from `cms/src/migrations/`) — before any languages work runs. This subsection amends §1.3–§1.6, §2.2, §2.7, §6, §10 for shared files.

Why languages stay on `Tenants` (not a vertical-settings collection): vertical-settings' own rule is "`Tenants` = universal fields only." `languages`/`defaultLanguage` are universal → they stay on `Tenants`. Do **not** route them through `cms/src/verticals/registry.ts`.

| Shared file | Current tree state (verified) | this plan does | coordination |
|-------------|-------------------------------|----------------|--------------|
| `cms/src/collections/Tenants.ts` | `hero` + `contact.emergencyNumber` already removed. Field order: `name`(283) `slug`(286) `type`(292) `applyTypeTemplate`(299) `domains`(302) `features`(306) `settingsEntitlement`(313) `branding`(323) `contact`(337) `socialPublishing`(380) … | §1.3 adds `languages` + `defaultLanguage` **between `features` (ends ~311) and `settingsEntitlement` (313)** | Compose; do not re-add `hero`. |
| `cms/src/access/tenantSettings.ts` | `hero` setting group already removed | §1.5 adds `languages`/`defaultLanguage` to `TENANT_PLATFORM_FIELDS` | Different array; compose. |
| `cms/src/payload.config.ts` | `localization.locales` = ar/en (196–203); `i18n.supportedLanguages` = {ar,en} (192–195); `VERTICAL_SETTINGS` registry wired (L36, L156–157, L268) | §1.2 extends both locale axes from the catalogue | Orthogonal; compose. |
| `cms/src/collections/tenantFeatures.ts` | `'healthcare'` feature present | not edited | Preserve `healthcare`; do not regress. |
| `cms/src/migrations/index.ts` | `130000` + `130100` registered (L31–32, L185–194, last entries; array closes L195) but **`.json` snapshots missing** | §1.6 adds `tenant_languages` after both | Register after A+B (later timestamp). **Snapshots for A+B must be committed first** (§10). |
| `astro/src/lib/tenant.ts` | `applyTenant` is already **4-arg** `applyTenant(strings, tenant, lang, healthcareSettings?)` (L142–147); `emergencyNumber` from `healthcareSettings?.emergencyNumber` (L167); `hero`/`tenant.contact.emergencyNumber` absent. `Tenant` interface (L17–38) still has paired `name/nameAr`(21), `tagline/taglineAr`(25), `established/establishedAr`(26), `contact.address/addressAr`(31), `contact.hours[]{day,dayAr,time,timeAr}`(36). `contact.social`(32–35) is **flat URLs, not localized**. `normalize()` still `loc()→[en,ar]` (L60–99). `languages`/`defaultLanguage` absent. | §2.2 adds `languages`/`defaultLanguage`, refactors paired identity/contact fields → locale maps, `normalize()` emits maps, `applyTenant` uses `pickLocalized` | Target the 4-arg signature; leave `contact.social` flat. |
| `astro/src/middleware.ts` | Order: dashboard-proxy (106–108) → tenant resolve/assign (109–110) → **healthcare fetch (115–125) → feature gate (127–131)**. `FEATURE_ROUTES` (7–20) still hardcode `(en\/)?`. | §2.7 inserts locale enforcement **immediately after L110 (`context.locals.tenant = tenant`)**, before the healthcare fetch + feature gate; replaces the hardcoded regex with a catalogue-derived one | Do NOT reorder vertical-settings' healthcare block — insert before it. |
| `astro/src/cms/shared/map.ts` + `blocks.ts` + `healthcare-settings.ts` | all three still pair-based: `map.ts loc()` (9–12), `blocks.ts pick()` (12–15), `healthcare-settings.ts LocalizedStat{value,valueAr,unit,unitAr}` (10–15), `stat()`/`pair()` (29–38). Consumers `HeroSection.astro` + `AchievementsSection.astro` read scalar `value/valueAr/unit/unitAr`. | §2.3 converts **all three** to locale maps; update the two section consumers | All three adapters + 2 consumers in one sweep (BLK-3). |

---

## 1. The one catalogue

`cms/src/collections/tenantLocales.ts` (CMS) and `LOCALES` in `astro/src/i18n/index.ts` (frontend) list the same codes — parity enforced by T1. Each CMS row owns its `value`, Payload picker label, tenant-field labels, and **`native` endonym** (so the picker stays in native script — C-5). Consumers use only the derived constants; they never create another locale-keyed label object.

---

## 2. Phase 1 — CMS plumbing (zero public-site change)

### 1.1 `cms/src/collections/tenantLocales.ts` (new)

```ts
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
```

### 1.2 `cms/src/payload.config.ts` — extend both locale axes from the catalogue

```ts
import { PLATFORM_LOCALES, DEFAULT_PLATFORM_LOCALE } from './collections/tenantLocales'
import { es } from '@payloadcms/translations/languages/es'
// ...
localization: {
  locales: PLATFORM_LOCALES.map((l) => ({ code: l.value, label: l.native })),  // native script in the picker (C-5)
  defaultLocale: DEFAULT_PLATFORM_LOCALE,
  fallback: true,
},
i18n: { supportedLanguages: { ar, en, es }, fallbackLanguage: DEFAULT_PLATFORM_LOCALE },
```
> No schema migration from §1.2 — Payload's localized columns are `<table>_locales(_locale text)`; adding a locale is runtime-only. The only Phase-1 migration is §1.6.

### 1.3 `cms/src/collections/Tenants.ts` — add `languages` + `defaultLanguage`

Add this import, then insert both fields **between `features` (ends ~L311) and `settingsEntitlement` (L313)** — semantic anchor: the field immediately preceding `settingsEntitlement`. (Do not use a line number alone; the tree shifts.)

```ts
import {
  DEFAULT_PLATFORM_LOCALE,
  FALLBACK_PLATFORM_LANGUAGES,
  PLATFORM_LOCALE_CODES,
  PLATFORM_LOCALE_OPTIONS,
  TENANT_LANGUAGE_FIELD_LABELS,
  type PlatformLocale,
} from './tenantLocales'
```

```ts
{
  name: 'languages', type: 'select', hasMany: true,
  options: PLATFORM_LOCALE_OPTIONS,
  defaultValue: FALLBACK_PLATFORM_LANGUAGES,  // sanctioned constant; Payload applies before collection beforeChange
  label: TENANT_LANGUAGE_FIELD_LABELS.languages,
  access: { update: superAdminFieldAccess },
  admin: { description: 'Locales published on this tenant. Drives switcher + route/locale gating. Platform-managed.' },
},
{
  name: 'defaultLanguage', type: 'select',
  options: PLATFORM_LOCALE_OPTIONS,
  // NO defaultValue — Payload would pre-apply the platform default on create and defeat the derive branch (BLK-5).
  label: TENANT_LANGUAGE_FIELD_LABELS.defaultLanguage,
  access: { update: superAdminFieldAccess },
  admin: { description: 'Fallback locale for missing translations; target of the `/` redirect when it differs from the unprefixed locale.' },
},
```
Do **not** add `required: true` to `defaultLanguage`: Payload field validation runs before the collection `beforeChange` hook, so `required` would reject a create before the hook can derive the value. The hook plus migration backfill are the invariant boundary.

### 1.4 `validateTenantLanguages` beforeChange — create-deriving, update-rejecting, timing-agnostic (BLK-5)

Derives on create (whether or not a default was supplied), rejects an explicit invalid default on update, preserves stored values on unrelated partial updates.

```ts
import { APIError } from 'payload'
import type { CollectionBeforeChangeHook } from 'payload'
const hasOwn = (o: unknown, k: PropertyKey): boolean =>
  typeof o === 'object' && o !== null && Object.prototype.hasOwnProperty.call(o, k)

const validateTenantLanguages: CollectionBeforeChangeHook = ({ data, operation, originalDoc }) => {
  if (operation !== 'create' && operation !== 'update') return data
  const incoming = data as Record<string, unknown>
  const stored = (originalDoc ?? {}) as Record<string, unknown>

  // languages: validate only when provided.
  let effective: PlatformLocale[]
  if (hasOwn(incoming, 'languages')) {
    const raw = incoming.languages
    if (!Array.isArray(raw)) throw new APIError('languages must be an array.', 400, null, true)
    const seen = new Set<PlatformLocale>(); const cleaned: PlatformLocale[] = []
    for (const code of raw) {
      if (!PLATFORM_LOCALE_CODES.includes(code as PlatformLocale))
        throw new APIError(`Unknown locale code: ${String(code)}.`, 400, null, true)
      const c = code as PlatformLocale
      if (seen.has(c)) throw new APIError(`Duplicate locale code: ${c}.`, 400, null, true)
      seen.add(c); cleaned.push(c)
    }
    if (cleaned.length === 0) throw new APIError('languages cannot be empty.', 400, null, true)
    incoming.languages = cleaned; effective = cleaned
  } else {
    effective = Array.isArray(stored.languages) ? (stored.languages as PlatformLocale[]) : FALLBACK_PLATFORM_LANGUAGES   // imported from tenantLocales (RC-3: use the sanctioned constant, not a literal)
  }

  const inSet = (c: unknown): c is PlatformLocale =>
    typeof c === 'string' && PLATFORM_LOCALE_CODES.includes(c as PlatformLocale) && effective.includes(c as PlatformLocale)

  if (operation === 'create') {
    // Derive: honor an explicit valid default, else prefer the platform default if in set, else effective[0].
    const explicit = hasOwn(incoming, 'defaultLanguage') ? incoming.defaultLanguage : undefined
    incoming.defaultLanguage = inSet(explicit) ? explicit
      : effective.includes(DEFAULT_PLATFORM_LOCALE) ? DEFAULT_PLATFORM_LOCALE : effective[0]
  } else {
    // Update: preserve an omitted default, but reject any update whose effective default is outside
    // the effective language set. This includes languages-only updates that remove the stored default.
    const defaultWasProvided = hasOwn(incoming, 'defaultLanguage')
    const effectiveDefault = defaultWasProvided ? incoming.defaultLanguage : stored.defaultLanguage
    if ((defaultWasProvided || hasOwn(incoming, 'languages')) && !inSet(effectiveDefault))
      throw new APIError(`defaultLanguage must be one of this tenant's languages: ${effective.join(', ')}.`, 400, null, true)
  }
  return data
}
```
Register last in `hooks.beforeChange` (currently `[enforceTenantSettingsEntitlement, copyTypeDefaultFeatures]`).

### 1.5 `cms/src/access/tenantSettings.ts` — platform-managed

Add to `TENANT_PLATFORM_FIELDS`: `'languages', 'defaultLanguage'`.

### 1.6 Migration — correct columns + clean-tree/snapshot gate + idempotent backfill

Payload hasMany-select join table columns are **`order, parent_id, value, id`** (verified: `cms/src/migrations/20260715_155701_settings_entitlement.ts:4-13`). `Tenants` is unversioned → no `_tenants_v` counterpart.

Generate (only after the §10 gate passes):
```bash
Push-Location cms; try { pnpm payload migrate:create tenant_languages } finally { Pop-Location }
```
**Allowlist** — the generated `up()` may contain only: `CREATE TABLE tenants_languages(order integer, parent_id integer NOT NULL, value text, id integer PRIMARY KEY, FK(parent_id)→tenants(id) ON DELETE cascade)` + `tenants_languages_order_idx` + `tenants_languages_parent_idx` + `ALTER TABLE tenants ADD COLUMN default_language text`. Anything else → abort.

Splice this exported idempotent backfill into the generated migration and call it once at the end of `up()`:
```ts
export async function backfillTenantLanguages(db: MigrateUpArgs['db']): Promise<void> {
  await db.run(sql`UPDATE tenants SET default_language = 'ar' WHERE default_language IS NULL;`)
  await db.run(sql`INSERT INTO tenants_languages (order, parent_id, value)
    SELECT 0, t.id, 'ar' FROM tenants t
    WHERE NOT EXISTS (SELECT 1 FROM tenants_languages l WHERE l.parent_id=t.id AND l.value='ar');`)
  await db.run(sql`INSERT INTO tenants_languages (order, parent_id, value)
    SELECT 1, t.id, 'en' FROM tenants t
    WHERE NOT EXISTS (SELECT 1 FROM tenants_languages l WHERE l.parent_id=t.id AND l.value='en');`)
}

// Final statement inside generated up():
await backfillTenantLanguages(db)
```
`down()`: `DROP TABLE tenants_languages;` + `ALTER TABLE tenants DROP COLUMN default_language;`. Register in `cms/src/migrations/index.ts`: add the import beside the `130100` import, then add exactly one array entry immediately after the `20260727_130100_drop_healthcare_fields_from_tenants` entry and before the closing bracket. Commit the paired `.json` snapshot.

### 1.7 Types
`pnpm --filter @bitrails-works/cms generate:types` → `Tenant.languages` / `Tenant.defaultLanguage` on `cms/src/payload-types.ts`.

### Phase 1 verify: T2–T5 and T14 (§9). `pnpm --filter @bitrails-works/cms payload migrate:status` applied; `curl /api/tenants?depth=0` shows both fields. Public site unchanged.

---

## 3. Phase 2 — Frontend locale model (N locales, full surface)

### 2.1 `astro/src/i18n/index.ts` — catalogue, A7-safe pick, tenant-aware toLang, split locale-tag maps

Add one valid strict-JSON `xx.json` per catalogue locale with **full key parity** (T6). Values: real translations if available; otherwise copy `en.json` byte-for-byte and record `TODO(i18n): translate <code>` in the PR description, never as a JSON comment. **No vitest.**

```ts
import ar from "./ar.json"; import en from "./en.json"; import es from "./es.json";

// APPEND new rows. Never reorder the first row: it is the unprefixed routing default.
// Put routing/SEO/date metadata here, never in consumers.
export const LOCALE_CATALOGUE = [
  { code: "ar", rtl: true,  unresolvedFallback: true,  og: "ar_EG", href: "ar-EG", date: "ar-EG" },
  { code: "en", rtl: false, unresolvedFallback: true,  og: "en_US", href: "en-US", date: "en-US" },
  { code: "es", rtl: false, unresolvedFallback: false, og: "es_ES", href: "es-ES", date: "es-ES" },
] as const;

export type Locale = (typeof LOCALE_CATALOGUE)[number]["code"];
export const LOCALES = LOCALE_CATALOGUE.map((row) => row.code) as Locale[];
export const DEFAULT_LOCALE: Locale = LOCALE_CATALOGUE[0].code;
export const UNPREFIXED_LOCALE: Locale = DEFAULT_LOCALE;
export const FALLBACK_LANGUAGES: Locale[] = LOCALE_CATALOGUE.filter((row) => row.unresolvedFallback).map((row) => row.code);
export const RTL_LOCALES: ReadonlySet<Locale> = new Set(LOCALE_CATALOGUE.filter((row) => row.rtl).map((row) => row.code));
export const OG_LOCALE_TAGS = Object.fromEntries(LOCALE_CATALOGUE.map((row) => [row.code, row.og])) as Record<Locale, string>;
export const HREFLANG_TAGS = Object.fromEntries(LOCALE_CATALOGUE.map((row) => [row.code, row.href])) as Record<Locale, string>;
export const DATE_LOCALE_TAGS = Object.fromEntries(LOCALE_CATALOGUE.map((row) => [row.code, row.date])) as Record<Locale, string>;

if (LOCALES.some((code) => !/^[a-z]{2}$/.test(code))) throw new Error("Locale codes must be lowercase two-letter ISO-639-1 codes.");
if (!FALLBACK_LANGUAGES.includes(DEFAULT_LOCALE)) throw new Error("The unresolved fallback set must include the default locale.");

// The import + this one registration entry are the one sanctioned config edit when adding a locale.
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
  m: Record<string, string> | undefined | null, lang: Locale, tenantDefault?: Locale,
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
    ? Object.fromEntries(Object.entries(f as Record<string, unknown>)
        .filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)]))
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
```

### 2.2 `astro/src/lib/tenant.ts` — carry locales + refactor paired identity/contact fields to maps (BLK-3/B3)

`applyTenant` is already 4-arg (L142–147); target that shape. Changes:

1. `Tenant` interface (L17–38): replace paired fields with locale maps —
   `name: Record<string,string>` (drop `nameAr`); `tagline?`, `established?`, `contact.address?`, `contact.hours[]{day,time}` each `Record<string,string>` (drop every `…Ar` sibling). Add `languages: Locale[]; defaultLanguage: Locale;`. **Leave `contact.social` flat** (URL strings, not localized).
2. `normalize()` (L60–99): emit maps via `toLocalizedMap` — `name: toLocalizedMap(doc.name)`, etc.; hours `day: toLocalizedMap(h.day), time: toLocalizedMap(h.time)`. Normalize locale fields exactly as follows: filter `doc.languages` through `LOCALES`, de-duplicate without reordering, use `FALLBACK_LANGUAGES` only when the result is empty, then accept `doc.defaultLanguage` only when it is in that result; otherwise use the first normalized language. Do not cast unvalidated CMS strings to `Locale`.
3. `applyTenant()` (L142–170): replace every `ar ? x.XAr : x.X` with `pickLocalized(x, lang, tenant.defaultLanguage)`; emergency stays from `healthcareSettings?.emergencyNumber` (L167, unchanged).
4. Both CMS backends must explicitly disable Payload fallback while reading maps: append `&fallback-locale=none` to `astro/src/cms/api/index.ts:13`; pass `fallbackLocale: false` beside `locale: "all"` in `astro/src/cms/in-process/index.ts:11-15`. This keeps `fallback: true` useful for ordinary Payload reads without allowing the global default to pre-fill tenant maps.

### 2.3 Localized adapters — all three shared files to locale maps (BLK-3)

- `astro/src/cms/shared/map.ts`: replace `loc()` (L9–12) with `toLocalizedMap` (import from `../../i18n`); every mapper emits maps (`title: toLocalizedMap(doc.title)`, drop `…Ar` keys). `num`/`str` keep scalar extraction for non-display scalars (year, order).
- `astro/src/cms/shared/blocks.ts`: replace `pick()` (L12–15) with map output; `ArticleBlock` fields (`html,text,alt,caption`) become `Record<string,string>`; pre-render Lexical per catalogue locale in the mapper (no per-request render).
- `astro/src/cms/shared/healthcare-settings.ts` (L10–38): `LocalizedStat` → `{ value: Record<string,string>; unit: Record<string,string> }`; `stat()`/`pair()` → `toLocalizedMap`.
- Consumers `HeroSection.astro` (L15–20) + `AchievementsSection.astro` (L13–18): add required prop `defaultLanguage: Locale`; bind `const fallback = Astro.props.defaultLanguage`; replace `isAr ? s.valueAr : s.value` with `pickLocalized(s.value, lang, fallback)` (same for `unit`). Their page callers pass `defaultLanguage={tenant?.defaultLanguage ?? FALLBACK_LANGUAGES[0]}`. Use the symbol `fallback` everywhere; do not introduce `tenantDefault`.

### 2.4 Sweep — five pinned transforms + one executable invariant script (BLK-2)

Create `astro/scripts/check-locale-invariants.ts`. It recursively scans `astro/src/**/*.{ts,astro,vue}` plus `astro/astro.config.mjs` and fails with `file:line:text` for: (a) any quoted catalogue code outside `src/i18n/index.ts`; (b) any two-locale string union; (c) `Astro.params.lang` used outside the canonical `toLang(...)` line; (d) hardcoded `/en` path construction; (e) `toggleToAr`/`toggleToEn`; or (f) an identifier ending in `Ar`. The only suffix exception is the exact identifier `fullNameAr` inside `components/portal/PortalSignUp.vue`, because it mirrors the excluded external portal API contract. The script imports `LOCALES`, constructs its quoted-code regex dynamically, and therefore needs no edit when a locale is added. Add package script `test:locale-invariants = "tsx scripts/check-locale-invariants.ts"`.

Use this exact script body:
```ts
import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LOCALES, UNPREFIXED_LOCALE } from "../src/i18n/index";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const src = resolve(root, "src");
const canonical = resolve(src, "i18n/index.ts");
const portalSignUp = resolve(src, "components/portal/PortalSignUp.vue");
const extensions = new Set([".ts", ".astro", ".vue"]);
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const localeAlternation = LOCALES.map(escape).join("|");
const prefixedAlternation = LOCALES.filter((locale) => locale !== UNPREFIXED_LOCALE).map(escape).join("|");

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return extensions.has(entry.name.slice(entry.name.lastIndexOf("."))) ? [path] : [];
  }));
  return nested.flat();
}

const files = [...await walk(src), resolve(root, "astro.config.mjs")];
const findings: string[] = [];
for (const file of files) {
  const original = await readFile(file, "utf8");
  const text = original
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .replace(/\/\/.*$/gm, "");
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    const errors: string[] = [];
    if (file !== canonical && new RegExp(`(["'])(?:${localeAlternation})\\1`).test(line)) errors.push("raw locale literal");
    if (/Astro\.params\.lang/.test(line) && !/toLang\(Astro\.params\.lang,/.test(line)) errors.push("non-canonical Astro.params.lang");
    if (prefixedAlternation && new RegExp(`/(?:${prefixedAlternation})(?:/|\\$\\{|["'\x60]|$)`).test(line)) errors.push("manual locale prefix");
    if (/toggleTo(?:Ar|En)\b/.test(line)) errors.push("binary toggle key");
    const arIdentifiers = line.match(/\b[A-Za-z][A-Za-z0-9]*Ar\b/g) ?? [];
    const forbiddenArIdentifiers = arIdentifiers.filter((name) => !(file === portalSignUp && name === "fullNameAr"));
    if (forbiddenArIdentifiers.length) errors.push(`legacy Ar identifier: ${forbiddenArIdentifiers.join(",")}`);
    if (errors.length) findings.push(`${relative(root, file)}:${index + 1}:${errors.join("; ")}:${original.split(/\r?\n/)[index]?.trim()}`);
  });
}
if (findings.length) {
  console.error(findings.join("\n"));
  process.exitCode = 1;
}
```

Apply these transforms in order:

1. **Every Astro page language derivation.** In every `astro/src/pages/**/*.astro`, place exactly one `const tenant = Astro.locals.tenant` immediately before the language declaration; delete any duplicate later declaration. Replace both ternary forms and `(Astro.params.lang || DEFAULT) as Locale` with:
   ```ts
   const lang = toLang(Astro.params.lang, tenant?.languages, tenant?.defaultLanguage);
   const fallback = tenant?.defaultLanguage;
   ```
   `astro/src/pages/index.astro` uses the same block; `Astro.params.lang` is `undefined` there. No page may retain a quoted locale code.
2. **Types.** Replace every single- or double-quoted two-locale union with imported `Locale`. Delete `astro/src/stores/locale.ts` completely: `rg -n 'useLocaleStore|stores/locale' astro/src` currently finds no importer, so retaining its independent browser locale state would create a second source of truth. In `astro/src/components/portal/api.ts`, delete its unused exported `Locale` declaration; do not re-export it (there are no importers). Every remaining consumer imports `type Locale` directly from `src/i18n/index.ts`.
3. **Localized display data.** After §2.2/§2.3 map conversion, replace every `X.fooAr/X.foo` selection with `pickLocalized(X.foo, lang, fallback)`. Astro components receive a required `defaultLanguage: Locale` prop and bind `fallback`; Vue components receive required `defaultLanguage: Locale` and `languages: Locale[]` props from their page/layout caller. No component reads `Astro.locals` unless it already runs server-side.
4. **Presentation-only binary branches.** For direction, font, or still-hardcoded launch-placeholder copy that does not read a CMS localized field, replace `lang === <locale>` / `isAr` with `isRTL(lang)` / `rtl`. Date formatting uses `DATE_LOCALE_TAGS[lang]`. This removes locale literals without inventing per-language branches; the `xx.json` remains the translation source for existing keyed strings.
5. **Paths and switchers.** Replace every manual prefix with `localePath`, `stripLocalePrefix`, `switchLocalePath`, or `languageSwitchLinks`. Do not use a fixed-width locale regex. For external portal response fields (`name_ar/name_en`), add the exact adapter below to `components/portal/api.ts`; `PortalAdmin.vue`, `PortalAppointments.vue`, and `PortalBook.vue` import it and replace every direct name field read/comparison with `portalName(item, props.lang, props.defaultLanguage)`. Their page/layout callers pass the same required `defaultLanguage` prop defined in §2.8. Preserve the external snake-case response properties; do not change the external API contract.

```ts
import {
  FALLBACK_LANGUAGES,
  UNPREFIXED_LOCALE,
  pickLocalized,
  type Locale,
} from '../../i18n'

type ExternalPortalName = { name_ar?: string | null; name_en?: string | null }
const EXTERNAL_PORTAL_SECONDARY = FALLBACK_LANGUAGES.find(
  (code) => code !== UNPREFIXED_LOCALE,
)
if (!EXTERNAL_PORTAL_SECONDARY) throw new Error('External portal requires a secondary fallback locale.')

export function portalName(
  item: ExternalPortalName | null | undefined,
  lang: Locale,
  defaultLanguage: Locale,
): string {
  const values: Partial<Record<Locale, string>> = {
    [UNPREFIXED_LOCALE]: item?.name_ar ?? '',
    [EXTERNAL_PORTAL_SECONDARY]: item?.name_en ?? '',
  }
  return pickLocalized(values, lang, defaultLanguage)
    || values[EXTERNAL_PORTAL_SECONDARY]
    || values[UNPREFIXED_LOCALE]
    || ''
}
```

Mandatory gates, in this order:
```bash
pnpm --filter @bitrails-works/astro test:locale-invariants
rg -n --pcre2 "['\"]ar['\"]\s*\|\s*['\"]en['\"]" astro/src --glob "*.{ts,astro,vue}"       # = 0
rg -n "Astro\.params\.lang\s*(===|\|\|)" astro/src --glob "*.astro"                         # = 0
rg -n --pcre2 '/en(?:\$\{|/|["\x27\x60]|$)' astro/src --glob "*.{ts,astro,vue}"              # = 0
rg -n "toggleTo(Ar|En)" astro/src astro/src/i18n --glob "*.{ts,astro,vue,json}"                # = 0
```

### 2.5 `astro/src/components/layout/TheTopBar.astro` — switcher (membership + querystring, C-8)
Use the shared pure helper; delete the existing `langSwitchUrl` declaration and binary toggle markup:
```ts
import { FALLBACK_LANGUAGES, languageSwitchLinks, type Locale } from "../../i18n";
const tenant = Astro.locals.tenant;
const langs: Locale[] = tenant?.languages?.length ? tenant.languages : FALLBACK_LANGUAGES;
const languageLinks = languageSwitchLinks(Astro.url.pathname, Astro.url.search, langs);
```
Replace the old switcher markup with exactly:
```astro
{languageLinks.length > 1 && (
  <nav aria-label="Languages" class="flex items-center gap-2">
    {languageLinks.map(({ locale, href }) => (
      <a href={href} hreflang={locale} aria-current={locale === lang ? "page" : undefined}>{locale.toUpperCase()}</a>
    ))}
  </nav>
)}
```
`TheSidebar.vue` and `PortalNav.vue` receive `languages` as a required prop, call `languageSwitchLinks(window.location.pathname, window.location.search, props.languages)`, render the same list with Vue `v-for`, and hide it when length ≤1. Update their callers in `SidebarLayout.astro` and `PortalLayout.astro` to pass `languages={tenant?.languages ?? FALLBACK_LANGUAGES}` and `defaultLanguage={tenant?.defaultLanguage ?? FALLBACK_LANGUAGES[0]}`. Remove all three old binary toggles at `TheTopBar.astro:81`, `TheSidebar.vue:53`, and `PortalNav.vue:26`; remove `strings.nav.toggleToEn/toggleToAr` from every `xx.json` in the same commit.

### 2.6 `astro/astro.config.mjs` — extend locales + sitemap (hyphen hreflang, C-9)
```ts
import { LOCALES, HREFLANG_TAGS, UNPREFIXED_LOCALE } from "./src/i18n";
i18n: { defaultLocale: UNPREFIXED_LOCALE, locales: [...LOCALES], routing: { prefixDefaultLocale: false } },
sitemap({ i18n: { defaultLocale: UNPREFIXED_LOCALE, locales: Object.fromEntries(LOCALES.map((l) => [l, HREFLANG_TAGS[l]])) } }),
```

### 2.7 `astro/src/middleware.ts` — catalogue-derived gating + locale enforcement + querystring redirect (BLK-2/BLK-4, C-4)

Replace the hardcoded `FEATURE_ROUTES` (L7–20, `(en\/)?`) with this exported pure builder. The optional quantifier wraps the **entire** locale prefix, not only its slash:
```ts
import {
  LOCALES, UNPREFIXED_LOCALE, localeFromPath, localePath, stripLocalePrefix, type Locale,
} from "./i18n";

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
    [route("(?:shop|cart|checkout|account)"), "commerce"],
  ];
};

export const FEATURE_ROUTES = buildFeatureRoutes(LOCALES, UNPREFIXED_LOCALE);
```
**Locale enforcement — insert immediately after L110 (`context.locals.tenant = tenant`), BEFORE the healthcare fetch (L115) and feature gate (L127):**
```ts
const path = context.url.pathname;   // MOVE the existing L127 declaration here; delete the old line.
const NON_CONTENT_EXACT = new Set(["/favicon.svg", "/icon.png", "/robots.txt", "/site.webmanifest"]);
const NON_CONTENT_PREFIXES = ["/admin", "/api", "/_next", "/_astro", "/_image", "/uploads", "/logo", "/images"];
export const isContentPath = (p: string) =>
  !NON_CONTENT_EXACT.has(p) && !NON_CONTENT_PREFIXES.some((pre) => p === pre || p.startsWith(pre + "/"));
if (tenant?.languages?.length && isContentPath(path)) {
  const allowed = tenant.languages as readonly Locale[];
  const requested = localeFromPath(path);
  const def = allowed.includes(tenant.defaultLanguage) ? tenant.defaultLanguage : allowed[0];
  if (!allowed.includes(requested)) {
    const dest = localePath(stripLocalePrefix(path), def);
    return context.redirect(dest + context.url.search, 302);
  }
}
```
Leave the existing dashboard-proxy block (106–108) and vertical-settings' healthcare block (115–125) untouched.

### 2.8 Layouts + cache/fail-open
- `BaseLayout.astro`: `locale` → `OG_LOCALE_TAGS[lang]`; `orgName` → `pickLocalized(tenant.name, lang, tenant.defaultLanguage)`; date formatting → `DATE_LOCALE_TAGS[lang]`; direction/font checks → `isRTL(lang)`. In each of `SidebarLayout.astro`, `ShopLayout.astro`, and `PortalLayout.astro`, import canonical `Locale`, replace its local two-locale type, use `pickLocalized` for tenant/CMS maps, and use `isRTL` only for direction/font/presentation branches.
- Vue islands: every page/layout caller passes required `defaultLanguage` and `languages` props. Each island binds `const fallback = props.defaultLanguage` and calls `pickLocalized(…, props.lang, fallback)`. The component and caller edits are one atomic change; optional props or local fallback literals are forbidden (C-6/C-12).
- Cache: tenant data cached 60s (`lib/tenant.ts`) → locale changes eventually consistent within 60s. Fail-open: unresolved tenant → `FALLBACK_LANGUAGES` + i18n defaults; in prod multi-tenant (`TENANT_UNRESOLVED_500=true`), content routes return 500 instead of serving unscoped content. **This prod-500 toggle is the one open product decision — sign off before merge.**

### Phase 2 verify: T1, T6–T10, T13, T15, T16 (§9). `pnpm --filter @bitrails-works/astro build` clean; §2.4 invariant script and all four textual gates empty.

---

## 4. Phase 3 — Admin dashboard (server-only, per A3/C-6)

3.1 Interface packs — done in §1.2. Per-user preference via Payload `user.language`.
3.2 Per-tenant content-locale scoping — **server boundary only.** Create `cms/src/access/localizedLocaleAccess.ts` with these exports and no alternate implementation:

- Import `APIError` and types `CollectionBeforeChangeHook, Field` from `payload`; import `PLATFORM_LOCALE_CODES` and `type PlatformLocale` from `../collections/tenantLocales`.
- Define `relationID(value)` exactly as: return `String(value.id)` for a non-null object with an `id`; return `String(value)` for a string/number; otherwise return `null`.
- All three recursive functions use this fixed field decision table: when a named field has `localized: true`, process that named value and stop descending; for `group`, `row`, or `collapsible`, recurse through `field.fields` (a named group changes the data cursor to `data[field.name]`); for `array`, recurse through `field.fields` for every object in `data[field.name]`; for `blocks`, select the block whose `slug` equals each row's `blockType` and recurse through that block's `fields`; for `tabs`, recurse through every tab's `fields`, changing the cursor to `data[tab.name]` only for a named tab; all other field types are unchanged.
- `hasLocalizedField(fields: Field[])`: applies the decision table and returns true when any reachable field has `localized: true`.
- `stripLocalizedFieldsForConcreteLocale(data, fields)`: applies the decision table and deletes each reached localized named field from `data`. Non-localized siblings are preserved byte-for-byte.
- `filterLocaleAllMaps(data, fields, allowed)`: applies the decision table; for a reached localized named field whose submitted value is a non-array object, delete object keys not in `allowed`. The schema position—not the object's shape—decides whether it is a locale map, so an inner Lexical object is never inspected as locales.
- `enforceTenantLocales(fields): CollectionBeforeChangeHook`: resolve the tenant id from `data.tenant ?? originalDoc?.tenant`; if absent, throw 400. Fetch that tenant with `req.payload.findByID({ collection: 'tenants', id, depth: 0, overrideAccess: true, req })`; filter/de-duplicate its languages through `PLATFORM_LOCALE_CODES` and throw 500 if the result is empty (stored tenant invariant violation). If `req.locale === 'all'`, call `filterLocaleAllMaps`. If `req.locale` is a concrete allowed locale, return unchanged. Otherwise call `stripLocalizedFieldsForConcreteLocale` and return the remaining data without throwing. Payload supplies the configured default when a Local API caller omits `locale`, so `undefined` is treated as disallowed rather than guessed.
- `enforceTenantDocumentLocales(fields): CollectionBeforeChangeHook`: the Tenants collection has localized identity/branding/contact fields but no `tenant` relationship, so derive allowed languages from the already-validated `data.languages ?? originalDoc.languages` and apply the same `req.locale` branches without a lookup.

In `cms/src/plugins/tenantFeatureAccess.ts`, add `import { enforceTenantLocales, hasLocalizedField } from '../access/localizedLocaleAccess'`. Register through the existing `tenantFeatureAccessPlugin` loop, not by editing every collection. At current lines 271-275, set hook order exactly to:
```ts
collection.hooks.beforeChange = [
  ...(collection.hooks.beforeChange ?? []),
  enforceSelectedTenant(policy),
  ...(hasLocalizedField(collection.fields ?? [])
    ? [enforceTenantLocales(collection.fields ?? [])]
    : []),
]
```
This order is mandatory: tenant-admin creates receive the injected tenant before locale enforcement; super-admin creates must supply `data.tenant`. The hook applies to every tenant-feature collection with localized fields, including nested Article blocks and plugin-owned localized commerce fields. **The `@payloadcms/ui` locale-tab-hiding variant remains out of scope.** Test through T11.

During Phase 3, update `cms/src/collections/Tenants.ts`: add `Field` to its `payload` type import; import `enforceTenantDocumentLocales` from `../access/localizedLocaleAccess`; extract the existing `fields` array to `const tenantFields: Field[]` without changing its order; set `fields: tenantFields`; and change hook order to exactly `[enforceTenantSettingsEntitlement, copyTypeDefaultFeatures, validateTenantLanguages, enforceTenantDocumentLocales(tenantFields)]`. Locale enforcement must remain after language validation so a languages/default update and localized Tenant fields use the same effective set. Phase 1 retains its three-hook order until this Phase-3 atomic change.

---

## 5. Out of scope
External portal backend (`PUBLIC_PORTAL_API_BASE`, separate repo). Path B. Routing A2. Auto-translation.

---

## 6. Touched-file manifest (structural — regenerate the rest via §2.4)

CMS: `collections/tenantLocales.ts` (new), `collections/Tenants.ts`, `access/tenantSettings.ts`, `access/localizedLocaleAccess.ts` (new, §3.2), `plugins/tenantFeatureAccess.ts`, `payload.config.ts`, `migrations/<ts>_tenant_languages.{ts,json}`, `migrations/index.ts`, `payload-types.ts` (regen), and the five `cms/tests/*` files named in §9.
Frontend fixed files: `i18n/index.ts`, `i18n/{ar,en,es}.json`, `lib/tenant.ts`, `cms/api/index.ts`, `cms/in-process/index.ts`, `cms/shared/{map,blocks,healthcare-settings}.ts`, `middleware.ts`, `astro.config.mjs`, `scripts/check-locale-invariants.ts` (new), delete unused `stores/locale.ts`, all 4 `layouts/*`, `components/layout/{TheTopBar.astro,TheSidebar.vue}`, `components/portal/{api.ts,PortalNav.vue,PortalAdmin.vue,PortalAppointments.vue,PortalBook.vue}`, `components/sections/{HeroSection,AchievementsSection}.astro`, and the nine `astro/tests/*` files named in §9.
Frontend sweep: every `src/pages/**/*.astro` plus every `*.astro`, `*.vue`, or `*.ts` file reported by the §2.4 invariant script. **No localized display `…Ar` field, two-locale union, raw catalogue-code comparison, old toggle key, or manual locale prefix may remain.** The sole exact `fullNameAr` identifier exception is pinned in §2.4.

---

## 7. Executor choices — all pinned

| Choice | Mandate |
|--------|---------|
| `xx.json` content | Strict JSON only. Copy `en.json` byte-for-byte when translations are unavailable; put `TODO(i18n): translate <code>` in the PR description. T6 enforces parity. |
| inline vs import | Import from the catalogue. Raw code literals exist only inside the two catalogue row tables, the static Payload `supportedLanguages` registration, migration SQL, and preserved external-portal wire property names. Everywhere else uses the named derived constants from §1.1/§2.1. |
| switcher widget | Inline list of `l.toUpperCase()` (§2.5). |
| old `toggleToEn/Ar` | Remove from TopBar, Sidebar, PortalNav, and all locale JSON in the same atomic change. |
| migration | Generate (`migrate:create`), allowlist-check, splice idempotent backfill. |
| Lexical render | Pre-render all catalogue locales in the mapper. |
| raw inline bilingual presentation copy | Replace locale comparison with `isRTL`; do not create a new locale-specific branch. CMS localized data always uses `pickLocalized`. |
| external portal `*_ar`/`*_en` fields | Adapt centrally in `components/portal/api.ts`; do not change the external API contract. |

---

## 8. Execution order
1. Create and run T14 as §10 step 2 → complete the remaining §10 snapshot/clean-tree gate → §1.1–§1.7 → T2–T5/T14 → merge.
2. §2.1–§2.8 + §6 → T1, T6–T10, T13, T15/T16 → `build` + §2.4 invariant gates → merge.
3. §3.2 → T11 → merge.

---

## 9. Mandatory automated tests (`node:test` + `tsx --test`; NO vitest)

Runner confirmed: Node `node:test` through `tsx --test`; no Vitest. CMS tests live in `cms/tests/`, Astro tests in `astro/tests/`. Add these exact scripts:
In `cms/package.json`:
```json
"test:tenant-languages": "tsx --test tests/tenant-languages-hook.test.ts tests/tenant-languages-access.test.ts tests/migration-tenant-languages.test.ts tests/migration-snapshot-baseline.test.ts tests/localized-locale-access.test.ts"
```
In `astro/package.json`:
```json
"test:locale-invariants": "tsx scripts/check-locale-invariants.ts",
"test:locales": "tsx --test tests/locale-parity.test.ts tests/i18n-parity.test.ts tests/localized-mappers.test.ts tests/feature-route-gating.test.ts tests/locale-redirect.test.ts tests/switcher.test.ts tests/path-prefix-sweep.test.ts tests/non-content-locale-gate.test.ts tests/cms-locale-all.test.ts && pnpm test:locale-invariants"
```

| ID | File | Asserts |
|----|------|---------|
| T1 | `astro/tests/locale-parity.test.ts` | `LOCALES` === `PLATFORM_LOCALE_CODES`; every code matches `/^[a-z]{2}$/`; `RTL_LOCALES`⊆`LOCALES`; OG/hreflang/date maps cover all; fallback constants are non-empty, contain only catalogue codes, and include their package default. |
| T2 | `cms/tests/tenant-languages-hook.test.ts` | create derives default (no throw); invalid/duplicate/empty → 400. |
| T3 | (same) | partial update of `contact.phone` leaves both fields byte-identical; explicit invalid default on update → 400; languages-only update that removes the stored default → 400; same update with a valid replacement default succeeds; create with no default + a catalogue-derived non-default subset derives its first entry. Test data is selected from exported catalogue arrays, not redeclared locale literals. |
| T4 | `cms/tests/tenant-languages-access.test.ts` | tenant admin cannot write the fields (403). |
| T5 | `cms/tests/migration-tenant-languages.test.ts` | copy DB → `up` once → assert schema/rows → execute the extracted backfill function a second time → assert no duplicates/value changes → `down` once → clean. Do not call generated DDL twice. |
| T6 | `astro/tests/i18n-parity.test.ts` | every `xx.json` key set == `en.json`. |
| T7 | `astro/tests/localized-mappers.test.ts` | `map.ts` + `blocks.ts` + `healthcare-settings.ts` emit maps. Bind `[unprefixed, fallback, third] = LOCALES`; assert `pickLocalized({[unprefixed]:"x",[fallback]:"",[third]:""}, third, fallback) === ""` (the launch catalogue is the required `{ar:"x",en:"",es:""}`, lang=es/default=en case); assert a non-empty fallback is returned; assert a map built only from the non-unprefixed tenant set never returns the unprefixed value. No test redeclares locale codes. |
| T8 | `astro/tests/feature-route-gating.test.ts` | import `buildFeatureRoutes`; for every exported `LOCALES` entry, every feature regex matches the correctly prefixed route; every regex matches the unprefixed route; `/endepartments` and equivalent concatenations do not match. Adding a catalogue row automatically expands the loop. |
| T9 | `astro/tests/locale-redirect.test.ts` | A/B/C matrix; bare prefixed root (for each prefixed catalogue locale), trailing-slash root, and **`?page=2` preservation**; unsupported locale redirects to tenant default. |
| T10 | `astro/tests/switcher.test.ts` | import `languageSwitchLinks`; returns exactly the supplied tenant language list, preserves querystrings, removes an existing prefix without a fixed-width regex, and the component visibility predicate is `links.length > 1`. |
| T11 | `cms/tests/localized-locale-access.test.ts` | concrete disallowed locale drops only localized fields; allowed locale persists; `locale=all` prunes map keys; nested Article block, localized commerce field, and localized Tenants identity field covered; plugin hook executes after tenant injection and Tenants hook executes after language validation. |
| T13 | `astro/tests/path-prefix-sweep.test.ts` | execute `scripts/check-locale-invariants.ts` and all §2.4 `rg` gates; assert zero findings. |
| T14 | `cms/tests/migration-snapshot-baseline.test.ts` | exact `130100` prerequisite snapshot contains `store_products_locales`, current `store_orders_rels.store_transactions_id` with its FK to `store_transactions`, both healthcare tables, and no dropped tenant hero/emergency columns. Use the exact test below. |
| T15 | `astro/tests/non-content-locale-gate.test.ts` | `isContentPath` is false for `/_astro`, `/_image`, all four public-root files, `/uploads`, `/logo`, `/images`, `/admin`, `/api`; true for `/`, prefixed/unprefixed content routes. |
| T16 | `astro/tests/cms-locale-all.test.ts` | REST URL contains `locale=all&fallback-locale=none`; Local API args contain `locale:'all', fallbackLocale:false`. |

Reconcile T1–T16 against the reviewer test artifact `C:/Users/mrt/.gstack/projects/dgh/mrt-main-eng-review-test-plan-20260727-131024.md`; REV 4 additions T14–T16 override any narrower artifact coverage.

Create T14 with this exact body (it continues to pass after the later tenant-language snapshot exists because it deliberately reads the `130100` prerequisite by name):

```ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const snapshotURL = new URL(
  '../src/migrations/20260727_130100_drop_healthcare_fields_from_tenants.json',
  import.meta.url,
)

test('130100 snapshot is the complete schema baseline for tenant languages', () => {
  const snapshot = JSON.parse(readFileSync(snapshotURL, 'utf8'))
  const tables = snapshot.tables as Record<string, any>

  assert.ok(tables.store_products_locales)
  assert.ok(tables.healthcare_settings)
  assert.ok(tables.healthcare_settings_locales)
  assert.ok(tables.store_orders_rels.columns.store_transactions_id)
  assert.equal(tables.store_orders_rels.columns.transactions_id, undefined)
  const transactionFK = Object.values(tables.store_orders_rels.foreignKeys).find(
    (fk: any) => fk.columnsFrom?.includes('store_transactions_id'),
  ) as any
  assert.equal(transactionFK?.tableTo, 'store_transactions')

  assert.equal(tables.tenants.columns.contact_emergency_number, undefined)
  for (const column of [
    'hero_years_value', 'hero_years_unit',
    'hero_departments_value', 'hero_departments_unit',
    'hero_patients_value', 'hero_patients_unit',
    'hero_staff_value', 'hero_staff_unit',
  ]) assert.equal(tables.tenants_locales.columns[column], undefined, column)
})
```

---

## 10. Migration safety gate (before §1.6)
1. `git status` shows **no** uncommitted CMS schema changes. `modular-vertical-settings` is committed, and both `20260727_130000_*.json` and `20260727_130100_*.json` are committed. If either is missing, stop and report `BLOCKED: vertical-settings snapshots not landed`; the languages executor must not manufacture historical snapshots.
2. Before any schema edit, create `cms/tests/migration-snapshot-baseline.test.ts` with the exact T14 body and run it. The named `130100` prerequisite snapshot must represent **all** schema migrations through `130100`, including post-`20260721_140149` commerce changes. This specifically prevents `20260722_100300_store_products_localization.ts` or healthcare schema from leaking into the generated language migration. Any T14 failure is a hard stop for the prerequisite owner, not an executor choice.
3. From `cms/`, run `pnpm payload migrate:create tenant_languages`.
4. **Allowlist:** generated `up()` contains only `tenants_languages` with columns `order,parent_id,value,id`, its order/parent indexes, and `tenants.default_language`. Generated `down()` contains only their inverse. Any `store_*`, `healthcare_*`, tenant hero/emergency, or other statement → delete the just-generated tenant-language pair, report the stale snapshot, and stop. This deletion is recoverable because the files were generated in this step and are uncommitted.
5. Add/export/call `backfillTenantLanguages` exactly as §1.6 specifies. Register the migration in `index.ts`; retain the generated `.json` snapshot.
6. Run T5 on a copied DB before `migrate` on the real DB. T5 calls schema `up` once and the backfill twice; it never calls generated DDL twice.

---

## 11. Verification gate (every phase)
- `pnpm --filter @bitrails-works/cms typecheck` clean.
- `pnpm --filter @bitrails-works/cms exec tsx --test tests/tenant-languages-hook.test.ts tests/tenant-languages-access.test.ts tests/migration-tenant-languages.test.ts tests/migration-snapshot-baseline.test.ts tests/localized-locale-access.test.ts` green.
- `pnpm --filter @bitrails-works/astro build` clean; `pnpm --filter @bitrails-works/astro test:locale-invariants` clean; §2.4 four textual gates empty.
- `pnpm --filter @bitrails-works/astro exec tsx --test tests/locale-parity.test.ts tests/i18n-parity.test.ts tests/localized-mappers.test.ts tests/feature-route-gating.test.ts tests/locale-redirect.test.ts tests/switcher.test.ts tests/path-prefix-sweep.test.ts tests/non-content-locale-gate.test.ts tests/cms-locale-all.test.ts` green.
- `pnpm --filter @bitrails-works/cms payload migrate:status` applied; `curl /api/tenants?depth=0` shows both fields for all tenants.
- Route matrix A/B/C exercised (T9) — paste output in the PR.
- `git diff --check` clean; no unrelated schema artifacts.

---

## 12. “Do not”
Path B; routing A2. Inline a locale code outside the sanctioned locations. Hand-write the tenant-language migration. Manufacture missing prerequisite snapshots. Expect a migration from adding a locale to `localization.locales`. Widen `Locale` without the matching strict-JSON `xx.json`. Put comments in JSON. Use a fixed-width prefix regex. Re-run generated DDL to test backfill idempotency. Make `languages`/`defaultLanguage` optional Vue props. Change direction/font behavior except by replacing raw comparisons with `isRTL`. Let tenant admins edit the fields. Fall back to the global unprefixed locale for resolved tenants (use `pickLocalized` with the tenant default). Restore `pickLocalized`'s first-available step. Drop querystrings on redirects/switches. Add `defaultValue` to `defaultLanguage`. Add Vitest. Implement `@payloadcms/ui` locale-tab hiding. Mark a phase done without its tests and §11 gate.

---

## 13. Revision changelog

### REV 3 (vs REV 2)

- **BLK-1** `pickLocalized` first-available step removed (ar-leak to non-ar tenant). T7 ar-leak case added.
- **BLK-2** §2.4: Transform 3 (path-prefix → `localePath`) + pt-D gate added; `--include=*.vue` added; full `…Ar` suffix set enumerated (incl. `valueAr/unitAr`).
- **BLK-3** `healthcare-settings.ts` + `HeroSection`/`AchievementsSection` added to §2.3/§6/gate.
- **BLK-4** redirect preserves `context.url.search`. T9 querystring assertion.
- **BLK-5** `defaultValue` removed from `defaultLanguage`; hook derives on create (timing-agnostic), rejects on update.
- **C-1** §0 sanctions `UNPREFIXED_LOCALE`/`FALLBACK_LANGUAGES` as the only literals; migration SQL excepted.
- **C-2** §13 #12 "(+ vitest added)" removed; runner is `node:test`/`tsx`.
- **C-3** §1.3 anchor = between `features` and `settingsEntitlement` (no bare line number).
- **C-4** §2.7/§0.5: locale enforcement after tenant assign, BEFORE healthcare fetch/gate (no reorder).
- **C-5** §1.2 locale picker uses native endonym.
- **C-6** Phase 3b UI tab-hiding dropped as infeasible; §3 is server-only; T12 removed.
- **C-8** §2.5 `switchTo` LOCALES-membership + querystring.
- **C-9** §2.1/§2.6 split `OG_LOCALE_TAGS` (underscore) / `HREFLANG_TAGS` (hyphen).
- **C-10** §2.1 `toLang` honors `supported`.
- **C-12** §2.8 Vue islands receive `defaultLanguage`/`languages` props.
- **NEW (digest)** §10 requires vertical-settings `.json` migration snapshots committed (currently missing).
- **REV 3.1 (post-verification)** RC-1: §2.4 `…Ar` gate now driven by the comprehensive `[A-Za-z]Ar\b` regex (was missing 7 of ~20 suffixes). RC-2: §2.7 hoists `const path` above the locale-enforcement block (was a TDZ/TS2448). RC-3: §2.5 + §1.4 use `FALLBACK_LANGUAGES`/`FALLBACK_PLATFORM_LANGUAGES` instead of bare `["ar","en"]` literals.

### REV 4 (final independent audit remediation)

- Corrected the catalogue-derived feature regex so the whole prefix is optional; exported `buildFeatureRoutes` for T8.
- Added exact bypasses for Astro `/_astro`, `/_image`, dashboard/API prefixes, media prefixes, and all public-root files; exported `isContentPath` for T15.
- Closed the languages-only update hole: removing the stored default now returns 400 unless the update supplies a valid replacement.
- Standardized every component fallback binding on required `defaultLanguage` → local `fallback`; pinned all caller edits.
- Removed remaining plan-prescribed locale literals from tenant defaults and Astro config; catalogue rows now own RTL/fallback/SEO/date metadata.
- Replaced the incomplete grep sweep with an exact invariant script, five ordered transforms, robust quote/spacing gates, and the one external portal identifier exception.
- Replaced prose-only switcher instructions with shared pure routing helpers and exact TopBar/Sidebar/PortalNav wiring.
- Replaced the Phase-3 placeholder with a recursive localized-field algorithm and exact plugin hook order.
- Corrected T5 to run DDL once and only the extracted backfill twice.
- Strengthened the snapshot prerequisite with T14 so all schema through `130100`, including post-20260721 commerce changes, is represented before generation.
- Explicitly disabled Payload fallback on both `locale=all` Astro backends.
- Made T14 executable rather than descriptive: it reads the named `130100` snapshot and asserts the commerce FK/table shape plus every healthcare column removal.
- Removed the unused independent locale store, pinned the external portal name adapter and its three consumers, and derived tenant-field labels from the CMS catalogue.

---

## 14. Resolution of all review findings

| Source | Finding | Resolution |
|--------|---------|------------|
| REV3-BLK1 / R2-B1 / OC-C3 | `pickLocalized` first-available leaks ar | dropped; T7 ar-leak case (§2.1, §9) |
| REV3-BLK2 / R2-B2 / OC-B1 | sweep/gate misses path-prefix + `*.vue` + suffixes | Transform 3 + pt-D + `*.vue` + full suffix set (§2.4) |
| REV3-BLK3 / R2-B3 | `healthcare-settings.ts` omitted | added to §2.3/§6/gate |
| REV3-BLK4 / R2-B4 / OC-B2 | redirect drops querystring | `dest + context.url.search` (§2.7) |
| REV3-BLK5 / R2-B5 | create throws (defaultValue timing) | no `defaultValue`; hook derives (§1.4) |
| R2-C1 / OC-C9 | inline `ar` vs §0 | sanctioned constants (§0) |
| R2-C2 / OC-C1 | vitest text contradiction | removed (§13) |
| R2-C3 / OC-C8 | insertion-point ambiguity | semantic anchor (§1.3) |
| R2-C4 / OC-C7 | middleware ordering text | insert before healthcare/gate (§2.7) |
| R2-C5 | admin labels forced English | native endonym (§1.2) |
| R2-C6 / OC-#8 | Phase 3b infeasible | dropped; server-only (§3) |
| R2-C7 | Playwright T12 | removed |
| R2-C8 / OC-switcher | switchTo querystring/membership | fixed (§2.5) |
| OC-C10 | hreflang format | split OG/hreflang maps (§2.1/§2.6) |
| OC-C2 | `toLang` A7 | honors `supported` (§2.1) |
| OC-C4 | pt-C count | regenerated, no hard count (§2.4) |
| OC-C6 / C-12 | Vue `tenantDefault` wiring | props (§2.8) |
| REV1 §13 #1–13 | (prior round) | all re-verified; see §13 |
| digest | missing `.json` snapshots | §10 gate |
| FINAL-B1 | optional-prefix regex makes only slash optional | whole-prefix builder + T8 (§2.7/§9) |
| FINAL-B2 | locale enforcement redirects Astro/static assets | exact/prefix non-content sets + T15 (§2.7/§9) |
| FINAL-B3 | languages-only update invalidates stored default | effective-default validation + T3 (§1.4/§9) |
| FINAL-B4 | unbound `fallback`/`tenantDefault` in components | required props + one `fallback` symbol (§2.3/§2.4/§2.8) |
| FINAL-B5 | prescribed locale literals violate §0 | derived field/config defaults + invariant script (§1.3/§2.4/§2.6) |
| FINAL-B6 | sweep misses inline binary branches; Ar gate has false positives | five transforms + dynamic script + external-contract exception (§2.4) |
| FINAL-B7 | server locale hook underspecified | exact recursive algorithm + plugin order (§3.2) |
| FINAL-B8 | T5 calls non-idempotent DDL twice | exported backfill tested twice, DDL once (§1.6/§9) |
| FINAL-B9 | snapshots after 20260721 not represented | T14 full-baseline gate and abort rule (§9/§10) |
| FINAL-C1 | `const path` move/remove choice | mandatory move and old-line deletion (§2.7) |
| FINAL-C2 | three switchers/markup not fully pinned | exact shared links and all three call sites (§2.5) |
| FINAL-C3 | quote-sensitive union gate | dynamic invariant script + PCRE gate (§2.4) |
| FINAL-C4 | fixed-width prefix/collision ambiguity | two-letter catalogue invariant + slice helper (§0/§2.1) |
| FINAL-C5 | tests target non-exported local helpers | exported pure helpers consumed by T8/T10/T15 (§2.1/§2.7/§9) |
| FINAL-C6 | duplicate locale types/dead browser locale store left to executor judgment | delete unused store; delete unused portal type; direct canonical imports (§2.4/§6) |
| FINAL-C7 | external portal adaptation and snapshot assertion remained prose | exact `portalName` adapter/callers and exact T14 body (§2.4/§9) |

---

## GSTACK REVIEW REPORT (audit history)

| Review | Runs | Status |
|--------|-----:|--------|
| Codex Review | 1 | ISSUES FOUND |
| Eng Review | 1 | BLOCKED (13) |
| OpenCode `glm-5.2` (REV 2) | 1 | BLOCKED (3 blockers, 10 concerns) |
| Independent review (REV 2) | 1 | BLOCKED (5 blockers, 8 concerns) |

**REV-4 NOTE:** every recorded finding is addressed in §13/§14. Implementation may begin only after the §10 prerequisite snapshot gate passes; that owned prerequisite is the sole pre-execution stop condition.
