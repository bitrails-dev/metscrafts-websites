// Per-tenant content-locale scoping — server boundary only (plan §3.2).
//
// The admin dashboard lets a tenant admin (or super-admin scoped to one tenant) edit content. A
// tenant publishes only the languages listed on its `Tenants.languages`. When a writer persists a
// document, this module enforces that the write cannot introduce values for locales the tenant does
// not enable:
//
//   - `locale='all'`         → prune locale-map keys that are not in the tenant's allowed set, but
//                              keep the localized field itself (the writer can still update the
//                              remaining locales in one round-trip).
//   - concrete allowed locale → no-op; the writer is editing a locale they are entitled to.
//   - any other concrete locale (disallowed, or `undefined`, which Local API callers never produce
//     because Payload supplies the configured default) → drop every localized named field from the
//     submitted payload. Non-localized siblings are preserved byte-for-byte.
//
// The schema-position rule is decisive: a value is treated as a locale map ONLY when its schema
// field is `localized: true`. An inner Lexical object (or any nested object) is never inspected as
// locales — we never descend into the value of a localized named field.
//
// This module is registered through `tenantFeatureAccessPlugin` (collection hook) and directly on
// `Tenants` (document hook — the Tenants collection has localized identity/branding/contact fields
// but no `tenant` relationship, so it derives its allowed set from its own `languages`).

import { APIError } from 'payload'
import type { CollectionBeforeChangeHook, Field } from 'payload'
import { PLATFORM_LOCALE_CODES } from '../collections/tenantLocales'
import type { PlatformLocale } from '../collections/tenantLocales'

// §3.2 — return String(value.id) for a non-null object with an `id`; String(value) for a
// string/number; otherwise null. Simpler than the relationID helpers in tenantFeatureAccess/Tenants
// on purpose: this hook only ever reads the freshly-stamped tenant id on a collection create.
export const relationID = (value: unknown): string | null => {
  if (value !== null && typeof value === 'object' && 'id' in value) {
    return String((value as { id?: unknown }).id)
  }
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  return null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

// The Payload `Field` / `Tab` unions include both named and unnamed variants (NamedGroupField vs
// UnnamedGroupField, NamedTab vs UnnamedTab, and the nameless `collapsible`/`row` containers).
// `name` exists as a property only on the named variants, so a direct `.name` access does not
// type-check across the whole union. `'name' in f` is the type-safe discriminator.
const getName = (f: object): string | undefined => {
  if ('name' in f) {
    const name = (f as { name?: unknown }).name
    if (typeof name === 'string') return name
  }
  return undefined
}

// Shared recursive walker (data-driven). Walks the schema tree per the §3.2 decision table and
// invokes `visitLocalizedNamed(cursor, name)` each time it reaches a named `localized: true` field.
// Never descends into the value of a localized named field — that is the "stop descending" rule,
// and it is what keeps an inner Lexical object from being inspected as locales.
type LocalizedVisitor = {
  visitLocalizedNamed: (cursor: Record<string, unknown>, name: string) => void
}

const walkFields = (
  cursor: Record<string, unknown>,
  fields: Field[] | undefined,
  visitor: LocalizedVisitor,
): void => {
  if (!fields) return
  for (const field of fields) {
    const name = getName(field)
    // Named + localized → process the named value and STOP descending. Schema position is what
    // makes the value a locale map; never inspect its inner shape.
    if (name !== undefined && (field as { localized?: boolean }).localized === true) {
      visitor.visitLocalizedNamed(cursor, name)
      continue
    }
    switch (field.type) {
      // group/row/collapsible all carry `.fields`. Only a named group moves the data cursor (rows
      // and collapsibles are unnamed UI containers).
      case 'group':
      case 'row':
      case 'collapsible': {
        if (field.type === 'group' && name !== undefined) {
          const child = cursor[name]
          if (isRecord(child)) walkFields(child, field.fields, visitor)
        } else {
          walkFields(cursor, field.fields, visitor)
        }
        break
      }
      // array → recurse through `.fields` for every object in `data[name]`.
      case 'array': {
        if (name === undefined) break
        const rows = cursor[name]
        if (Array.isArray(rows)) {
          for (const row of rows) {
            if (isRecord(row)) walkFields(row, field.fields, visitor)
          }
        }
        break
      }
      // blocks → for each row, select the block whose slug matches row.blockType, recurse its fields.
      case 'blocks': {
        if (name === undefined || !Array.isArray(field.blocks)) break
        const rows = cursor[name]
        if (!Array.isArray(rows)) break
        for (const row of rows) {
          if (!isRecord(row)) continue
          const blockSlug = (row as { blockType?: unknown }).blockType
          const block = field.blocks.find((candidate) => candidate.slug === blockSlug)
          if (block) walkFields(row, block.fields, visitor)
        }
        break
      }
      // tabs → recurse every tab's `.fields`, moving the cursor to `data[tab.name]` only for a
      // named tab.
      case 'tabs': {
        if (!Array.isArray(field.tabs)) break
        for (const tab of field.tabs) {
          const tabName = getName(tab)
          if (tabName !== undefined) {
            const child = cursor[tabName]
            if (isRecord(child)) walkFields(child, tab.fields, visitor)
          } else {
            walkFields(cursor, tab.fields, visitor)
          }
        }
        break
      }
      default:
        // All other field types are unchanged.
        break
    }
  }
}

// §3.2 — schema-only check (no data needed): true when any field reachable through the decision
// table has `localized: true`. Used by the plugin loop to decide whether to register the
// collection-level locale hook on a given collection.
export const hasLocalizedField = (fields: Field[]): boolean => {
  for (const field of fields) {
    const name = getName(field)
    if (name !== undefined && (field as { localized?: boolean }).localized === true) {
      return true
    }
    switch (field.type) {
      case 'group':
      case 'row':
      case 'collapsible':
        if (field.fields && hasLocalizedField(field.fields)) return true
        break
      case 'array':
        if (field.fields && hasLocalizedField(field.fields)) return true
        break
      case 'blocks':
        if (Array.isArray(field.blocks)) {
          for (const block of field.blocks) {
            if (block.fields && hasLocalizedField(block.fields)) return true
          }
        }
        break
      case 'tabs':
        if (Array.isArray(field.tabs)) {
          for (const tab of field.tabs) {
            if (tab.fields && hasLocalizedField(tab.fields)) return true
          }
        }
        break
      default:
        break
    }
  }
  return false
}

// §3.2 — concrete disallowed-locale branch. Delete each reached localized named field from `data`.
// Non-localized siblings (and the localized field's sibling keys inside a group) are preserved
// byte-for-byte.
export const stripLocalizedFieldsForConcreteLocale = (
  data: Record<string, unknown>,
  fields: Field[],
): void => {
  walkFields(data, fields, {
    visitLocalizedNamed: (cursor, name) => {
      delete cursor[name]
    },
  })
}

// §3.2 — `locale='all'` branch. For a reached localized named field whose submitted value is a
// non-array object, delete object keys not in `allowed`. Schema position — not object shape —
// decides it is a locale map; we never recurse into the object.
export const filterLocaleAllMaps = (
  data: Record<string, unknown>,
  fields: Field[],
  allowed: ReadonlySet<PlatformLocale>,
): void => {
  walkFields(data, fields, {
    visitLocalizedNamed: (cursor, name) => {
      const value = cursor[name]
      if (isRecord(value)) {
        for (const key of Object.keys(value)) {
          if (!allowed.has(key as PlatformLocale)) delete value[key]
        }
      }
    },
  })
}

// Filter + de-duplicate a tenant's `languages` through the platform catalogue. Returns the cleaned
// set, or an empty set if the stored value is missing/invalid.
const cleanAllowedLocales = (raw: unknown): Set<PlatformLocale> => {
  const out = new Set<PlatformLocale>()
  if (!Array.isArray(raw)) return out
  for (const code of raw) {
    if (
      typeof code === 'string' &&
      (PLATFORM_LOCALE_CODES as readonly string[]).includes(code)
    ) {
      out.add(code as PlatformLocale)
    }
  }
  return out
}

// §3.2 — collection-level hook. For tenant-scoped collections (every collection in
// TENANT_COLLECTION_FEATURES that has localized fields). Resolves the tenant id from
// `data.tenant ?? originalDoc?.tenant` (throws 400 if absent — super-admin creates MUST supply
// `data.tenant`, and tenant-admin creates had it injected by `enforceSelectedTenant`, which runs
// BEFORE this hook), fetches the tenant, and dispatches on `req.locale`.
export const enforceTenantLocales =
  (fields: Field[]): CollectionBeforeChangeHook =>
  async ({ data, originalDoc, req }) => {
    const cursor = data as Record<string, unknown>
    const stored = (originalDoc ?? {}) as Record<string, unknown>

    const tenantID = relationID(cursor.tenant ?? stored.tenant)
    if (!tenantID) {
      throw new APIError(
        'Cannot enforce per-tenant locale access without a tenant on the document.',
        400,
        null,
        true,
      )
    }

    const tenant = (await req.payload.findByID({
      collection: 'tenants',
      id: tenantID,
      depth: 0,
      overrideAccess: true,
      req,
    })) as { languages?: unknown }

    const allowed = cleanAllowedLocales(tenant.languages)
    if (allowed.size === 0) {
      // The validateTenantLanguages hook guarantees a non-empty, catalogue-clean set on Tenants. An
      // empty allowed set here means the stored tenant invariant was violated out-of-band.
      throw new APIError(
        'Tenant has no allowed languages; stored tenant invariant violated.',
        500,
        null,
        true,
      )
    }

    const locale = req.locale
    if (locale === 'all') {
      filterLocaleAllMaps(cursor, fields, allowed)
      return data
    }
    if (typeof locale === 'string' && allowed.has(locale as PlatformLocale)) {
      // Concrete allowed locale — persist unchanged.
      return data
    }
    // Disallowed concrete locale, or `undefined` (Payload supplies the configured default when a
    // Local API caller omits `locale`, so undefined is treated as disallowed rather than guessed).
    stripLocalizedFieldsForConcreteLocale(cursor, fields)
    return data
  }

// §3.2 — document-level hook for the Tenants collection itself. Tenants has localized identity/
// branding/contact fields but no `tenant` relationship, so the allowed set is derived from the
// already-validated `data.languages ?? originalDoc.languages` (validateTenantLanguages runs BEFORE
// this hook and rejects invalid sets). No tenant lookup.
export const enforceTenantDocumentLocales =
  (fields: Field[]): CollectionBeforeChangeHook =>
  ({ data, originalDoc, req }) => {
    const cursor = data as Record<string, unknown>
    const stored = (originalDoc ?? {}) as Record<string, unknown>

    const allowed = cleanAllowedLocales(cursor.languages ?? stored.languages)

    const locale = req.locale
    if (locale === 'all') {
      filterLocaleAllMaps(cursor, fields, allowed)
      return data
    }
    if (typeof locale === 'string' && allowed.has(locale as PlatformLocale)) {
      return data
    }
    stripLocalizedFieldsForConcreteLocale(cursor, fields)
    return data
  }
