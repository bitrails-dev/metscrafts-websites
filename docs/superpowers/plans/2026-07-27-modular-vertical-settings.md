# Modular vertical settings — reviewed implementation plan

- **Date:** 2026-07-27
- **Status:** REVIEWED — ready for a mechanical executor
- **Scope:** Add the reusable vertical-settings registry and move the existing hospital/clinic hero statistics plus emergency number from `tenants` into one tenant-scoped `healthcare-settings` document for every existing healthcare tenant, with at most one document per tenant thereafter.
- **Execution model:** One agent, one branch, sequential phases. Do not parallelize the schema, data migration, and frontend cutover.
- **Safety rule:** The working tree was already dirty when this plan was reviewed. Preserve unrelated edits. Never reset, discard, stage, or rewrite files outside this plan's file list.

## 1. Goal and fixed decisions

`Tenants` must contain only fields that apply to every tenant type. Vertical-specific configuration belongs in a tenant-scoped settings collection and is registered once through a shared registry.

The following decisions are final; the implementer must not reopen them:

1. Both `hospital` and `clinic` tenant types are healthcare verticals. Current database rows prove both use the same hero shape.
2. This change moves exactly `hero` and `contact.emergencyNumber`. Branding, general contact information, social links, domains, feature flags, and social-publishing fields remain on `Tenants`.
3. Enforce one settings document per tenant twice: a readable `beforeChange` error and a database `UNIQUE(tenant_id)` index. The hook alone has a create/create race.
4. `admin.useAsTitle` is `tenant`; do not add a redundant label field.
5. The checked-in repository is the only discoverable consumer. External consumers, if any, must migrate before deploying the destructive migration.
6. Data backfill belongs in the versioned migration. Do not create or run a one-off backfill script.
7. The final frontend source of truth is `healthcare-settings`. Remove active reads of the legacy tenant fields and static hero JSON; do not keep two writable/active sources.

## 2. What already exists

- `cms/src/collections/commerce/CommerceSettings.ts` is the proven tenant-scoped settings collection and already has a one-per-tenant hook.
- `cms/src/plugins/tenantFeatureAccess.ts` is the authoritative feature-policy map.
- `cms/tests/tenant-feature-gating-invariant.test.ts` checks every plugin-injected tenant collection is governed or explicitly exempted.
- `astro/src/cms/` already implements both REST and in-process Payload backends behind `CmsBackend`; all new frontend CMS reads must go through this seam.
- `astro/src/middleware.ts` resolves one tenant per request and stores it in `Astro.locals`.
- Current SQLite data stores localized hero values in `tenants_locales` and the emergency number in `tenants.contact_emergency_number`.
- Current hero components read `astro/src/content/settings/hero.json`; current emergency-number UI is populated through i18n/`applyTenant`, not directly from `tenant.hero`. The old draft's Astro assumptions were incorrect.

## 3. Target architecture and invariants

```text
TenantFeature union + options
            |
            v
cms/src/verticals/registry.ts
  entry = { config, feature }
       |              |
       |              +--> tenantFeatureAccessPlugin policy map
       +------------------> Payload collections + multiTenantPlugin map

HTTP request
    |
    v
Astro middleware -- resolve tenant once
    |
    +-- tenant lacks healthcare --> healthcareSettings = undefined
    |
    +-- tenant has healthcare ---> CmsBackend.getHealthcareSettings(tenant.id)
                                      |                   |
                                      v                   v
                                  REST backend       Local API backend
                                      \                   /
                                       normalized view model
                                               |
                                               v
                                Astro.locals.healthcareSettings
                                  |              |             |
                                  v              v             v
                              hero stats   achievements   emergency UI
```

Required invariants:

- At most one `healthcare-settings` row may exist for a tenant. Migration A must create exactly one for every existing eligible tenant; newly created healthcare tenants must receive one during their launch/configuration workflow before public launch.
- Only tenants of type `hospital` or `clinic` receive the `healthcare` feature during migration.
- Every locale row and all four existing stats (`years`, `departments`, `patients`, `staff`) are copied byte-for-byte.
- Existing feature arrays are preserved; `healthcare` is appended only when absent.
- Applying migrations on a populated database must not require an operator-run script.
- Rolling back Migration B must restore hero/emergency data to `tenants` before Migration A drops `healthcare-settings`.
- Both `CMS_MODE=api` and `CMS_MODE=in-process` expose identical normalized settings.
- A request performs at most one healthcare-settings read.
- After cutover, no runtime file reads `tenant.hero`, `tenant.contact.emergencyNumber`, or `content/settings/hero.json`.

## 4. NOT in scope

- `library`, `dealer`, `pharmacy`, or other vertical settings collections.
- Moving universal branding/contact/social fields out of `Tenants`.
- A generic settings UI renderer or dynamic runtime plugin discovery.
- Changing the public page design, labels, stat order, or fallback copy.
- Modifying external repositories. Deployment is blocked until any external reader of the removed fields is migrated.
- A one-off backfill CLI. Versioned migrations are the only production data path.

## 5. Pre-flight gate

Run from `C:\Users\mrt\Desktop\dgh` in PowerShell:

```powershell
git status --short
git diff --check
pnpm --filter @bitrails-works/cms typecheck
pnpm --filter @bitrails-works/cms exec tsx --test tests/tenant-access.test.ts tests/tenant-feature-access.test.ts tests/tenant-feature-gating-invariant.test.ts tests/tenant-settings.test.ts tests/tenant-settings.integration.test.ts tests/tenant-types.test.ts tests/tenant-types.integration.test.ts
pnpm --filter @bitrails-works/astro build
```

Record failures before editing. A pre-existing failure is not permission to weaken a later gate.

Stop all Astro/CMS processes that can write the database. Create a recoverable SQLite-consistent backup; do not use `Copy-Item` on the live WAL database and do not overwrite an existing backup:

```powershell
$sourceDb = (Resolve-Path 'cms/cms.db').Path
$backupDb = Join-Path (Split-Path $sourceDb) 'cms.db.pre-vertical-settings-20260727'
if (Test-Path -LiteralPath $backupDb) { throw "Backup already exists: $backupDb" }
$backupSqlitePath = $backupDb.Replace('\', '/')
Push-Location cms
try { sqlite3 cms.db ".backup '$backupSqlitePath'" } finally { Pop-Location }
if (-not (Test-Path -LiteralPath $backupDb)) { throw 'SQLite backup was not created' }
sqlite3 $backupDb 'PRAGMA integrity_check;'
Get-FileHash -Algorithm SHA256 -LiteralPath $backupDb
```

Stop if hashes differ, migration status is not fully applied, or the backup target already exists.

## 6. Sequential implementation phases

### Phase 1 — Add the feature and shared one-per-tenant hook

Files:

- Modify `cms/src/collections/tenantFeatures.ts`.
- Add `cms/src/collections/utils/singlePerTenant.ts`.
- Modify `cms/src/collections/commerce/CommerceSettings.ts`.
- Add `cms/tests/single-per-tenant.test.ts`.

Actions:

1. Add `| 'healthcare'` to `TenantFeature` immediately after `commerce`.
2. Add `{ value: 'healthcare', label: { ar: 'الرعاية الصحية', en: 'Healthcare' } }` to `TENANT_FEATURES`.
3. Move the existing `CommerceSettings` `singlePerTenant` hook into a factory:

   ```ts
   import type { CollectionBeforeChangeHook, CollectionSlug } from 'payload'

   type SettingsCollectionSlug = 'commerce-settings' | 'healthcare-settings'

   export const singlePerTenant = (slug: SettingsCollectionSlug): CollectionBeforeChangeHook =>
     async ({ data, operation, req }) => {
       if (operation !== 'create') return data
       const tenant = (data as { tenant?: number | string | { id?: number | string } }).tenant
       const tenantId = tenant && typeof tenant === 'object' ? tenant.id : tenant
       if (tenantId === undefined || tenantId === null) return data

       const { totalDocs } = await req.payload.count({
         // The generated CollectionSlug union does not include a brand-new collection until
         // generate:types runs. Keep the factory's closed union above and cast only at this API seam.
         collection: slug as CollectionSlug,
         where: { tenant: { equals: tenantId } },
         overrideAccess: true,
         req,
       })
       if (totalDocs > 0) {
         const { APIError } = await import('payload')
         throw new APIError(`This tenant already has a ${slug} document.`, 400, null, true)
       }
       return data
     }
   ```

4. In `CommerceSettings`, replace its local hook with `singlePerTenant('commerce-settings')`. Do not change secret handling or field order.
5. Unit-test: create without tenant passes through; first create passes; duplicate create throws 400; update does not count; scalar and `{ id }` relationships behave identically.

Gate:

```powershell
pnpm --filter @bitrails-works/cms typecheck
pnpm --filter @bitrails-works/cms exec tsx --test tests/single-per-tenant.test.ts
```

### Phase 2 — Add `HealthcareSettings`, then add the registry

Files:

- Add `cms/src/collections/healthcare/HealthcareSettings.ts`.
- Add `cms/src/verticals/registry.ts`.
- Add `cms/tests/vertical-settings-registry.test.ts`.

Create `HealthcareSettings` before the registry so no phase intentionally leaves a broken import.

`HealthcareSettings` requirements:

- `slug: 'healthcare-settings'`.
- Healthcare bilingual labels/admin group.
- `admin.useAsTitle: 'tenant'`.
- `access.read: () => true` because hero statistics and the emergency number are public website content. Create/update/delete remain authenticated and feature-gated by the existing plugin.
- `hooks.beforeChange: [singlePerTenant('healthcare-settings')]`.
- No manually declared `tenant` field; `multiTenantPlugin` injects it.
- Move the existing `stat()` field factory verbatim from `Tenants.ts` for now. Do not remove it from `Tenants` until Phase 5.
- Fields, in this exact order:
  - `hero` group.
  - `hero.years`, `hero.departments`, `hero.patients`, `hero.staff`, each using the existing localized `value` and `unit` shape and existing labels/required flags.
  - `emergencyNumber`, non-localized text, using the existing tenant-field label.

Then add `cms/src/verticals/registry.ts`:

```ts
import type { CollectionConfig } from 'payload'
import type { TenantFeature } from '../collections/tenantFeatures'
import { CommerceSettings } from '../collections/commerce/CommerceSettings'
import { HealthcareSettings } from '../collections/healthcare/HealthcareSettings'

export type VerticalSettingsEntry = Readonly<{
  config: CollectionConfig
  feature: TenantFeature
}>

export const VERTICAL_SETTINGS = [
  { config: CommerceSettings, feature: 'commerce' },
  { config: HealthcareSettings, feature: 'healthcare' },
] as const satisfies readonly VerticalSettingsEntry[]

export const verticalSettingsCollections = Object.fromEntries(
  VERTICAL_SETTINGS.map(({ config }) => [config.slug, {}]),
)

export const verticalSettingsFeatureMap = Object.fromEntries(
  VERTICAL_SETTINGS.map(({ config, feature }) => [
    config.slug,
    { features: feature, tenantScoped: true as const },
  ]),
)
```

Do not claim future verticals are literally a one-folder change. They still require a feature declaration, registry entry, migration, tests, and frontend integration. The registry removes only the three duplicated CMS wiring edits.

Registry tests must assert:

- slugs are unique;
- entries are exactly `commerce-settings → commerce` and `healthcare-settings → healthcare`;
- `verticalSettingsCollections` is exactly `{ 'commerce-settings': {}, 'healthcare-settings': {} }`;
- the feature map uses `tenantScoped: true` for both.

Gate:

```powershell
pnpm --filter @bitrails-works/cms typecheck
pnpm --filter @bitrails-works/cms exec tsx --test tests/vertical-settings-registry.test.ts
```

### Phase 3 — Wire all CMS consumers from the registry

Files:

- Modify `cms/src/payload.config.ts`.
- Modify `cms/src/plugins/tenantFeatureAccess.ts`.
- Modify `cms/tests/tenant-feature-access.test.ts`.
- Modify `cms/tests/tenant-feature-gating-invariant.test.ts` only if an assertion needs the new explicit expected slug; do not weaken its discovery logic.

Actions:

1. In `payload.config.ts`, stop importing `CommerceSettings` through the commerce barrel used by the `collections` array. Keep all other commerce imports.
2. Import `VERTICAL_SETTINGS` and `verticalSettingsCollections` from the registry.
3. Replace the single `CommerceSettings` collection entry with `...VERTICAL_SETTINGS.map(({ config }) => config)`.
4. In `multiTenantPlugin({ collections: { ... } })`, remove the literal `'commerce-settings': {}` and spread `...verticalSettingsCollections` in the same position. This option is a slug-keyed object, not an array.
5. In `tenantFeatureAccess.ts`, keep every non-settings policy exactly as-is, remove only the literal `commerce-settings` policy, and merge `verticalSettingsFeatureMap` after the core map.
6. Add `healthcare-settings` to the capability matrix in `tenant-feature-access.test.ts`; it must require `healthcare`, not `commerce`.
7. Add access assertions proving anonymous read is allowed for `healthcare-settings`, while anonymous create/update/delete remain denied. This explicit public-read exception is required by both Astro backends; do not make all settings collections public.

Gates:

```powershell
pnpm --filter @bitrails-works/cms typecheck
pnpm --filter @bitrails-works/cms exec tsx --test tests/tenant-feature-access.test.ts tests/tenant-feature-gating-invariant.test.ts tests/vertical-settings-registry.test.ts
pnpm --filter @bitrails-works/cms generate:types
pnpm --filter @bitrails-works/cms generate:importmap
```

Verify generated `cms/src/payload-types.ts` contains `HealthcareSetting`, and the sanitized config contains each settings collection exactly once.

### Phase 4 — Migration A: create, constrain, and backfill atomically

Files:

- Add generated `cms/src/migrations/<timestamp>_add_and_backfill_healthcare_settings.ts`.
- Modify generated `cms/src/migrations/index.ts`.
- Add `cms/tests/healthcare-settings-migration.test.ts`.

Generate the migration only after Phase 3:

```powershell
Push-Location cms
try { pnpm payload migrate:create add_and_backfill_healthcare_settings } finally { Pop-Location }
```

Review and edit the generated migration. Its `up()` must run in this order:

1. Create `healthcare_settings` and `healthcare_settings_locales` with generated foreign keys and timestamp indexes.
2. Create `healthcare_settings_tenant_idx` if the generator did not.
3. Create `healthcare_settings_tenant_unique` on `healthcare_settings(tenant_id)`. Fail the migration if duplicate tenant IDs already exist; do not silently deduplicate.
4. Insert one settings parent row for every tenant whose joined `tenant_types.slug` is `hospital` or `clinic`. Copy `contact_emergency_number`; preserve tenant `created_at`/`updated_at` when compatible, otherwise use the migration timestamp consistently.
5. Insert every matching row from `tenants_locales` into `healthcare_settings_locales`, mapping all eight hero value/unit columns and preserving `_locale`.
6. Append `healthcare` to `tenant_types_default_features` for the `hospital` and `clinic` parents only when absent. Use `COALESCE(MAX("order") + 1, 0)` per parent.
7. Append `healthcare` to `tenants_features` for tenants of those types only when absent, again assigning the next per-parent order.
8. Run SQL assertions before returning:
   - eligible tenant count equals healthcare-settings parent count;
   - eligible locale-row count equals healthcare-settings locale-row count;
   - every eligible tenant/type has the new feature exactly once;
   - zero non-healthcare tenants/types have the new feature.
   Throw on mismatch so the migration transaction rolls back.

Before inserting any feature row, assert that `healthcare` is absent from both feature tables. Because this feature is new, pre-existing raw rows indicate drift; stop rather than making `down()` unable to distinguish user data from migration-owned data.

Reject the generated migration if it contains schema changes unrelated to `healthcare_settings`, its locale/relation tables, indexes, or the explicitly documented feature-row inserts.

The migration `down()` must reverse only Phase 4 data/schema:

1. Remove `healthcare` feature rows from eligible tenants and tenant types.
2. Drop the healthcare-settings locale table, parent table, and indexes.

Do not modify legacy tenant hero/emergency columns in Migration A. They remain the rollback source until Migration B.

Migration test fixture must contain:

- one hospital with `ar` and `en` hero rows;
- one clinic with only `ar` hero data;
- one pharmacy/non-healthcare tenant;
- an existing unrelated feature on every row;
- a rerun/idempotency assertion for the SQL inserts or an explicit assertion that the migration ledger prevents a second application;
- up assertions for byte-identical localized values, feature preservation, feature isolation, and unique-index enforcement;
- down assertions that legacy tenant data is unchanged and new tables/features are removed.

Apply first to a scratch copy, never directly to the working database:

```powershell
$scratchDb = Join-Path $env:TEMP 'dgh-vertical-settings-phase-a.db'
if (Test-Path -LiteralPath $scratchDb) { Remove-Item -LiteralPath $scratchDb }
$scratchSqlitePath = $scratchDb.Replace('\', '/')
Push-Location cms
try { sqlite3 cms.db ".backup '$scratchSqlitePath'" } finally { Pop-Location }
$previousDatabaseUri = $env:DATABASE_URI
try {
  $env:DATABASE_URI = "file:$scratchDb"
  Push-Location cms
  try {
    pnpm payload migrate
    pnpm payload migrate:status
  } finally { Pop-Location }
} finally {
  $env:DATABASE_URI = $previousDatabaseUri
}
```

Gate:

```powershell
pnpm --filter @bitrails-works/cms exec tsx --test tests/healthcare-settings-migration.test.ts
```

### Phase 5 — Remove legacy CMS fields and create reversible Migration B

Files:

- Modify `cms/src/collections/Tenants.ts`.
- Modify `cms/src/access/tenantSettings.ts`.
- Add generated `cms/src/migrations/<timestamp>_drop_healthcare_fields_from_tenants.ts`.
- Modify generated `cms/src/migrations/index.ts`.
- Modify tenant-settings tests that enumerate setting groups.

Code changes:

1. Delete the `hero` group from `Tenants`.
2. Delete `contact.emergencyNumber`; preserve all other contact fields and order.
3. Delete the old `stat()` helper only after `HealthcareSettings` owns its copy.
4. Remove `hero` from `TenantSettingGroup`, `TENANT_SETTING_GROUPS`, and `SETTING_GROUP_FIELDS`. Preserve every other entitlement group.

Generate Migration B from this exact intermediate state:

```powershell
Push-Location cms
try { pnpm payload migrate:create drop_healthcare_fields_from_tenants } finally { Pop-Location }
```

Review the generated SQLite table rebuild. Migration B `up()` must:

- remove `contact_emergency_number` from `tenants`;
- remove all `hero_*` columns from `tenants_locales`;
- preserve every other column, foreign key, index, locale row, ID, and timestamp;
- use `PRAGMA foreign_keys` exactly as established migrations do;
- assert healthcare-settings coverage before the first destructive statement.

Migration B `down()` must be data-preserving, not merely schema-preserving:

1. Recreate the legacy emergency and hero columns/tables through the generated reverse rebuild.
2. Copy `healthcare_settings.emergency_number` back to `tenants.contact_emergency_number` by `tenant_id`.
3. Copy every healthcare locale's eight hero columns back to the matching `tenants_locales` row by tenant and locale.
4. Assert restored parent/locale counts before returning.

Extend `healthcare-settings-migration.test.ts` to execute `A.up → B.up → B.down → A.down` and prove all original tenant data is byte-identical after the full round trip.

Gates:

```powershell
pnpm --filter @bitrails-works/cms typecheck
pnpm --filter @bitrails-works/cms exec tsx --test tests/tenant-access.test.ts tests/tenant-settings.test.ts tests/tenant-settings.integration.test.ts tests/tenant-types.test.ts tests/tenant-types.integration.test.ts tests/healthcare-settings-migration.test.ts
pnpm --filter @bitrails-works/cms generate:types
```

Verify the generated `Tenant` type has neither `hero` nor `contact.emergencyNumber`.

### Phase 6 — Cut Astro to the new settings source through both CMS backends

Files:

- Modify `astro/src/cms/types.ts`.
- Modify `astro/src/cms/index.ts`.
- Modify `astro/src/cms/api/index.ts`.
- Modify `astro/src/cms/in-process/index.ts`.
- Add `astro/src/cms/shared/healthcare-settings.ts`.
- Modify `astro/src/lib/tenant.ts`.
- Modify `astro/src/middleware.ts` while preserving the existing dashboard-proxy changes.
- Modify `astro/src/env.d.ts`.
- Modify `astro/src/pages/[...lang]/index.astro`.
- Modify `astro/src/pages/index.astro`.
- Modify `astro/src/pages/[...lang]/contact.astro`.
- Modify `astro/src/layouts/SidebarLayout.astro`.
- Modify `astro/src/components/sections/HeroSection.astro`.
- Modify `astro/src/components/sections/AchievementsSection.astro`.
- Delete `astro/src/content/settings/hero.json` after all imports are gone.
- Add `astro/tests/healthcare-settings.test.ts` and add the corresponding test script/dev dependency to `astro/package.json` (updating `pnpm-lock.yaml`).

Implementation contract:

1. Define exported `LocalizedStat` and `HealthcareSettings` view-model types in the shared settings module. Keep four named stats and `emergencyNumber`; do not expose raw Payload documents to components.
2. Add `getHealthcareSettings(tenantId)` to `CmsBackend` and the top-level `astro/src/cms/index.ts` facade.
3. REST backend: reuse its existing `fetchDocs('healthcare-settings', tenantId, 1)` path and normalize the first row.
4. In-process backend: reuse its existing tenant-filtered Local API finder with limit `1` and normalize the first row.
5. Put the document-to-view-model normalization in one shared function used by both backends. It must preserve `locale=all` `{ en, ar }` values and return `undefined` for zero rows. Throw if more than one row is returned because that violates the unique invariant.
6. Remove `healthcare`-owned fields from the frontend `Tenant` interface and `normalize()` mapper. Add `healthcare` to the frontend `TenantFeature` union.
7. Extend `applyTenant(strings, tenant, lang, healthcareSettings?)` so the emergency number comes from `healthcareSettings`; remove the old `tenant.contact.emergencyNumber` branch.
8. In middleware, after resolving the tenant, call `getHealthcareSettings(tenant.id)` only when `tenant.features.includes('healthcare')`; assign the result to `context.locals.healthcareSettings`. This is the single settings read for the request. Dashboard-proxy requests continue to bypass both tenant and settings reads.
9. Add `healthcareSettings?: HealthcareSettings` to `App.Locals`.
10. Pass the local settings into `applyTenant` in `SidebarLayout.astro` and the contact page.
11. Pass the local settings from the home page to `HeroSection` and `AchievementsSection`. Both components must render the same four stats in the same order and choose Arabic/English from the normalized values. Remove their JSON imports.
    Apply this to both `astro/src/pages/index.astro` (Arabic root entry) and `astro/src/pages/[...lang]/index.astro` (localized entry); leaving either call site unchanged fails the cutover.
12. After updating all readers, delete `hero.json`. Do not delete unrelated content settings.
13. Missing settings behavior: log one server warning containing the tenant slug and render no stat items; keep existing generic i18n emergency fallback so the page stays usable. This is a failure mode, not a second active CMS data source.

Frontend tests must cover:

- shared normalization of `locale=all` values;
- API and in-process backends returning the same view model for equivalent docs (mock their fetch/find seams);
- zero rows returns `undefined`; more than one row throws;
- `applyTenant` prefers healthcare emergency data and keeps the i18n fallback when missing;
- Arabic and English stat selection;
- the middleware does not fetch settings for non-healthcare tenants and fetches exactly once for healthcare tenants.

Gates:

```powershell
pnpm install
pnpm --filter @bitrails-works/astro test:healthcare-settings
pnpm --filter @bitrails-works/astro build
rg -n "tenant\.hero|contact\.emergencyNumber|content/settings/hero|heroSettings" astro/src
```

The final `rg` must return no active legacy reader/import. References in historical documentation do not count.

### Phase 7 — Full verification and production migration proof

Update `CLAUDE.md` before running the gates: replace the stale statement that all retired hospital settings live on `Tenants` with the new boundary (`Tenants` owns universal identity/contact; `healthcare-settings` owns healthcare hero/emergency data). Do not change unrelated documentation.

Run all gates from the root:

```powershell
pnpm --filter @bitrails-works/cms typecheck
pnpm --filter @bitrails-works/cms exec tsx --test tests/single-per-tenant.test.ts tests/vertical-settings-registry.test.ts tests/tenant-access.test.ts tests/tenant-feature-access.test.ts tests/tenant-feature-gating-invariant.test.ts tests/tenant-settings.test.ts tests/tenant-settings.integration.test.ts tests/tenant-types.test.ts tests/tenant-types.integration.test.ts tests/healthcare-settings-migration.test.ts
pnpm --filter @bitrails-works/cms generate:types
pnpm --filter @bitrails-works/cms generate:importmap
pnpm --filter @bitrails-works/cms build
pnpm --filter @bitrails-works/astro test:healthcare-settings
pnpm --filter @bitrails-works/astro build
git diff --check
```

Then apply both migrations to a fresh copy of the real database and verify exact data:

```powershell
$verificationDb = Join-Path $env:TEMP 'dgh-vertical-settings-final.db'
if (Test-Path -LiteralPath $verificationDb) { Remove-Item -LiteralPath $verificationDb }
$verificationSqlitePath = $verificationDb.Replace('\', '/')
Push-Location cms
try { sqlite3 cms.db ".backup '$verificationSqlitePath'" } finally { Pop-Location }
$previousDatabaseUri = $env:DATABASE_URI
try {
  $env:DATABASE_URI = "file:$verificationDb"
  Push-Location cms
  try {
    pnpm payload migrate
    pnpm payload migrate:status
  } finally { Pop-Location }
} finally {
  $env:DATABASE_URI = $previousDatabaseUri
}
```

SQL verification must establish:

- settings rows exist for `damietta-general-hospital` and `test-clinic`;
- no settings row exists for `pilot` or non-healthcare types;
- hospital has both `ar` and `en` settings locales; clinic preserves its existing locale set;
- `healthcare` occurs exactly once in eligible tenant/type feature arrays;
- `healthcare_settings_tenant_unique` exists;
- legacy hero/emergency columns are absent only after Migration B;
- no other tenant/locale column, index, or row count changed.

Manual smoke in both modes:

```powershell
$env:CMS_MODE = 'in-process'; pnpm --filter @bitrails-works/astro dev
$env:CMS_MODE = 'api';        pnpm --filter @bitrails-works/astro dev
```

For each mode, verify hospital Arabic/English hero stats, achievements stats, sidebar/footer/contact emergency number, clinic values, and a non-healthcare tenant. Stop each dev server before changing mode.

## 7. Rollback procedure

Preferred rollback is versioned:

1. Stop application traffic.
2. Run one Payload rollback to execute Migration B `down()`; verify tenant hero/emergency data was restored.
3. Run a second rollback to execute Migration A `down()`; verify healthcare settings tables/features are removed.
4. Deploy the previous application commit.

Emergency recovery if versioned rollback fails:

1. Stop the app and CMS.
2. Preserve the failed database under a new incident filename.
3. Restore `cms.db.pre-vertical-settings-20260727` to the configured database location.
4. Deploy the previous application commit.

Never run Migration A `down()` before Migration B `down()`; doing so destroys the only source available to restore the legacy fields.

## 8. Failure modes and required handling

| Failure | Required behavior |
|---|---|
| Concurrent settings creates | Hook gives readable error in the common case; DB unique index decides the race safely. |
| Migration A coverage mismatch | Throw before destructive work; transaction rolls back. |
| Migration B started without complete backfill | Pre-drop assertion throws; no legacy column is removed. |
| Locale missing for one tenant | Preserve the existing locale set exactly; do not invent translated values. |
| Settings row missing at runtime | Log tenant slug, omit stats, retain generic emergency fallback; do not query legacy tenant fields. |
| REST CMS unavailable | Existing backend error behavior remains; no silent switch to stale JSON. |
| Duplicate settings rows | Backend normalization throws; migration/DB uniqueness must be repaired. |
| Generated SQLite rebuild omits unrelated column/index | Reject the migration during review; do not apply it. |
| External consumer still reads removed fields | Block deployment until migrated. |

## 9. Test diagram

```text
Unit
  singlePerTenant factory
  registry uniqueness/mapping
  settings normalization + locale selection
  applyTenant emergency overlay
        |
        v
Config integration
  Payload collection registered once
  multi-tenant field injected
  feature policy enforced
        |
        v
Migration integration
  seeded legacy DB
    -> A.up creates + copies + grants
    -> B.up removes legacy schema
    -> B.down restores legacy data
    -> A.down removes new schema
  final bytes == initial bytes
        |
        v
Build/runtime
  CMS typecheck/build/types/importmap
  Astro API-mode build + in-process build
  bilingual hospital + clinic smoke
```

## 10. Performance review

- The registry is evaluated once during config construction; its maps are tiny and static.
- The unique index makes tenant settings lookup O(log n) and prevents duplicate rows.
- Middleware performs one extra indexed lookup only for healthcare tenants. Do not fetch independently in multiple components.
- Do not add a second cache in this change. The tenant list already has a 60-second cache; settings freshness and invalidation require a separate product decision and are unnecessary for correctness.

## 11. File checklist

New:

- `cms/src/collections/utils/singlePerTenant.ts`
- `cms/src/collections/healthcare/HealthcareSettings.ts`
- `cms/src/verticals/registry.ts`
- `cms/src/migrations/<timestamp>_add_and_backfill_healthcare_settings.ts`
- `cms/src/migrations/<timestamp>_drop_healthcare_fields_from_tenants.ts`
- `cms/tests/single-per-tenant.test.ts`
- `cms/tests/vertical-settings-registry.test.ts`
- `cms/tests/healthcare-settings-migration.test.ts`
- `astro/src/cms/shared/healthcare-settings.ts`
- `astro/tests/healthcare-settings.test.ts`

Modified:

- `cms/src/collections/tenantFeatures.ts`
- `cms/src/collections/commerce/CommerceSettings.ts`
- `cms/src/collections/Tenants.ts`
- `cms/src/access/tenantSettings.ts`
- `cms/src/payload.config.ts`
- `cms/src/plugins/tenantFeatureAccess.ts`
- `cms/src/migrations/index.ts`
- `cms/src/payload-types.ts` (generated)
- `cms/src/app/(payload)/admin/importMap.js` (generated only if changed)
- `cms/tests/tenant-feature-access.test.ts`
- `cms/tests/tenant-feature-gating-invariant.test.ts` (only if explicit expectations change)
- tenant-settings tests affected by removal of the `hero` entitlement group
- `astro/src/cms/types.ts`
- `astro/src/cms/index.ts`
- `astro/src/cms/api/index.ts`
- `astro/src/cms/in-process/index.ts`
- `astro/src/lib/tenant.ts`
- `astro/src/middleware.ts`
- `astro/src/env.d.ts`
- `astro/src/pages/[...lang]/index.astro`
- `astro/src/pages/index.astro`
- `astro/src/pages/[...lang]/contact.astro`
- `astro/src/layouts/SidebarLayout.astro`
- `astro/src/components/sections/HeroSection.astro`
- `astro/src/components/sections/AchievementsSection.astro`
- `astro/package.json`
- `pnpm-lock.yaml`
- `CLAUDE.md` (update the CMS architecture note: healthcare settings no longer live on `Tenants`)

Deleted:

- `astro/src/content/settings/hero.json`

Forbidden/unplanned edits require stopping and updating this plan before continuing.

## 12. Implementation tasks

- [ ] **T1 (P1)** — Feature and shared hook — complete Phase 1 and its unit test.
- [ ] **T2 (P1)** — Collection and registry — complete Phase 2 with no broken intermediate import.
- [ ] **T3 (P1)** — CMS wiring and access — complete Phase 3 and all invariant gates.
- [ ] **T4 (P1)** — Additive migration — create Migration A, atomic SQL backfill, assertions, unique index, and migration tests.
- [ ] **T5 (P1)** — Destructive migration — remove legacy config, create reversible Migration B, and prove the full migration round trip.
- [ ] **T6 (P1)** — Frontend cutover — implement both CMS backends, one middleware read, all component consumers, and remove static hero data.
- [ ] **T7 (P1)** — Release proof — run Phase 7 gates on a copied populated database and smoke both CMS modes.

Dependency chain: `T1 → T2 → T3 → T4 → T5 → T6 → T7`. This is intentionally sequential; parallel agents would share config, generated types, migrations, middleware, and the same data contract.

## GSTACK REVIEW REPORT

| Runs | Status | Findings |
|---:|---|---:|
| 2 | CLEAN AFTER REVISION | 11 issues found and folded into the plan |

### Findings absorbed

1. Reordered collection before registry so every phase has a green compile gate.
2. Replaced the operator-run backfill script with an atomic, versioned data migration.
3. Required a database unique index to close the hook's concurrency race.
4. Corrected SQLite layout: localized hero columns live in `tenants_locales`; emergency lives in `tenants`.
5. Made rollback restore data before dropping the new tables.
6. Corrected Astro's real data flow: current readers use static JSON/i18n and must cut through both CMS backends.
7. Added precise tests for registry, hook, feature access, migration round trip, dual backends, and middleware fetch count.
8. Removed all executor-owned decisions, placeholders, and unresolved questions.
9. Corrected the registry promise: it removes three CMS wiring edits but does not make a complete vertical a literal one-folder change.
10. Added the explicit public-read contract required by anonymous REST and Local API website reads.
11. Replaced unsafe live-WAL file copies with SQLite-consistent backups.

### Completion summary

- Scope challenge: accepted as a necessary cross-CMS/frontend data migration; no unrelated verticals added.
- Architecture: 4 issues found and resolved.
- Code quality: 2 issues found and resolved.
- Tests: diagram added; 2 critical gaps resolved.
- Performance: 1 issue resolved by one middleware fetch per request.
- Parallelization: sequential; zero safe independent implementation lanes.
- Failure modes: 9 documented with required behavior.
- Outside voice: ran; all verified findings were absorbed.

**VERDICT: CLEARED FOR MECHANICAL IMPLEMENTATION**

NO UNRESOLVED DECISIONS
