import assert from 'node:assert/strict'
import test from 'node:test'
import type { CollectionBeforeChangeHook, Config, Field } from 'payload'

import {
  enforceTenantDocumentLocales,
  enforceTenantLocales,
  filterLocaleAllMaps,
  hasLocalizedField,
  stripLocalizedFieldsForConcreteLocale,
} from '../src/access/localizedLocaleAccess'
import { tenantFeatureAccessPlugin } from '../src/plugins/tenantFeatureAccess'
import { Tenants, validateTenantLanguages } from '../src/collections/Tenants'
import { PLATFORM_LOCALE_CODES } from '../src/collections/tenantLocales'
import type { PlatformLocale } from '../src/collections/tenantLocales'

// T11 — per-tenant localized-locale access (plan §3.2 / §9).
//
// Hard constraint honored: every locale VALUE in test data is pulled from the exported catalogue
// arrays (`PLATFORM_LOCALE_CODES`) or derived from them via `.slice`/indexing. No catalogue code is
// redeclared as a literal. Synthetic field trees stand in for real collections — the recursive
// decision table is field-shape-driven, so the schema fragments below exercise every branch
// (group/array/blocks/tabs/localized-named/other) without booting Payload.

// Catalogue-derived subsets — never redeclare a catalogue code as a literal.
const ALLOWED_LANGS = PLATFORM_LOCALE_CODES.slice(0, 1) as PlatformLocale[] // first code only
const DISALLOWED_LOCALE = PLATFORM_LOCALE_CODES[1] as PlatformLocale
const ALLOWED_LOCALE = ALLOWED_LANGS[0]
const PRUNED_LOCALE = PLATFORM_LOCALE_CODES[2] as PlatformLocale // present in map, outside allowed
const ALLOWED_SET = new Set<PlatformLocale>(ALLOWED_LANGS)

// ---------------------------------------------------------------------------
// Pure recursive function tests — exercise every decision-table branch via synthetic field trees.
// ---------------------------------------------------------------------------

test('hasLocalizedField: true for a direct localized named field', () => {
  const fields: Field[] = [
    { name: 'title', type: 'text', localized: true },
    { name: 'sku', type: 'text' },
  ]
  assert.equal(hasLocalizedField(fields), true)
})

test('hasLocalizedField: false when no reachable field is localized', () => {
  const fields: Field[] = [
    { name: 'sku', type: 'text' },
    { name: 'price', type: 'number' },
  ]
  assert.equal(hasLocalizedField(fields), false)
})

test('hasLocalizedField: descends through a named group, array, blocks, and tabs', () => {
  const fields: Field[] = [
    {
      name: 'branding',
      type: 'group',
      fields: [{ name: 'tagline', type: 'text', localized: true }],
    },
    {
      name: 'hours',
      type: 'array',
      fields: [{ name: 'day', type: 'text', localized: true }],
    },
    {
      name: 'content',
      type: 'blocks',
      blocks: [
        { slug: 'heading', fields: [{ name: 'text', type: 'text', localized: true }] },
      ],
    },
    {
      type: 'tabs',
      tabs: [{ label: 'Tab', fields: [{ name: 'tabbed', type: 'text', localized: true }] }],
    },
  ]
  assert.equal(hasLocalizedField(fields), true)
})

test('hasLocalizedField: row/collapsible UI containers are traversed (unnamed, no cursor move)', () => {
  const fields: Field[] = [
    {
      type: 'row',
      fields: [
        {
          type: 'collapsible',
          label: 'Group',
          fields: [{ name: 'deep', type: 'text', localized: true }],
        },
      ],
    },
  ]
  assert.equal(hasLocalizedField(fields), true)
})

test('stripLocalizedFieldsForConcreteLocale: drops only the localized named field, preserves siblings byte-for-byte', () => {
  const fields: Field[] = [
    { name: 'title', type: 'text', localized: true },
    { name: 'sku', type: 'text' },
    { name: 'price', type: 'number' },
  ]
  const data: Record<string, unknown> = { title: 'X', sku: 'Y', price: 10 }
  stripLocalizedFieldsForConcreteLocale(data, fields)
  assert.equal('title' in data, false, 'localized field must be deleted')
  assert.equal(data.sku, 'Y', 'non-localized sibling preserved byte-for-byte')
  assert.equal(data.price, 10, 'non-localized sibling preserved byte-for-byte')
})

test('stripLocalizedFieldsForConcreteLocale: descends into a named group, deletes the inner localized field only', () => {
  const fields: Field[] = [
    {
      name: 'branding',
      type: 'group',
      fields: [
        { name: 'tagline', type: 'text', localized: true },
        { name: 'initials', type: 'text' },
      ],
    },
  ]
  const data: Record<string, unknown> = {
    branding: { tagline: 'X', initials: 'YZ' },
  }
  stripLocalizedFieldsForConcreteLocale(data, fields)
  const branding = data.branding as Record<string, unknown>
  assert.equal('tagline' in branding, false, 'localized group child deleted')
  assert.equal(branding.initials, 'YZ', 'non-localized group child preserved')
})

test('stripLocalizedFieldsForConcreteLocale: descends into array rows and blocks', () => {
  const fields: Field[] = [
    {
      name: 'hours',
      type: 'array',
      fields: [{ name: 'day', type: 'text', localized: true }],
    },
    {
      name: 'content',
      type: 'blocks',
      blocks: [
        { slug: 'heading', fields: [{ name: 'text', type: 'text', localized: true }] },
      ],
    },
  ]
  const data: Record<string, unknown> = {
    hours: [{ day: 'Sun', time: '9-5' }, { day: 'Mon', time: '10-6' }],
    content: [{ blockType: 'heading', text: 'Hi' }],
  }
  stripLocalizedFieldsForConcreteLocale(data, fields)
  const hours = data.hours as Array<Record<string, unknown>>
  for (const row of hours) {
    assert.equal('day' in row, false, 'localized array child deleted per row')
    assert.equal('time' in row, true, 'non-localized array child preserved per row')
  }
  const content = data.content as Array<Record<string, unknown>>
  assert.equal('text' in content[0], false, 'localized block field deleted')
  assert.equal(content[0].blockType, 'heading', 'blockType discriminator preserved')
})

test('stripLocalizedFieldsForConcreteLocale: tabs descend through named and unnamed tabs', () => {
  const fields: Field[] = [
    {
      type: 'tabs',
      tabs: [
        { name: 'main', fields: [{ name: 'lead', type: 'text', localized: true }] },
        { label: 'Other', fields: [{ name: 'sidebar', type: 'text', localized: true }] },
      ],
    },
  ]
  const data: Record<string, unknown> = {
    main: { lead: 'X' },
    sidebar: 'Y',
  }
  stripLocalizedFieldsForConcreteLocale(data, fields)
  assert.equal('lead' in (data.main as Record<string, unknown>), false)
  assert.equal('sidebar' in data, false)
})

test('filterLocaleAllMaps: prunes keys outside `allowed`, keeps the field and allowed keys', () => {
  const fields: Field[] = [
    { name: 'title', type: 'text', localized: true },
    { name: 'sku', type: 'text' },
  ]
  const data: Record<string, unknown> = {
    title: { [ALLOWED_LOCALE]: 'A', [PRUNED_LOCALE]: 'B', [DISALLOWED_LOCALE]: 'C' },
    sku: 'Y',
  }
  filterLocaleAllMaps(data, fields, ALLOWED_SET)
  const title = data.title as Record<string, unknown>
  assert.equal('title' in data, true, 'localized field itself preserved (locale=all prunes keys only)')
  assert.equal(title[ALLOWED_LOCALE], 'A', 'allowed key preserved')
  assert.equal(title[PRUNED_LOCALE], undefined, 'pruned key removed')
  assert.equal(title[DISALLOWED_LOCALE], undefined, 'pruned key removed')
  assert.equal(data.sku, 'Y', 'non-localized sibling untouched')
})

test('filterLocaleAllMaps: array values are left intact (non-array rule); non-localized objects are never inspected (schema-position rule)', () => {
  // A localized field whose value is an ARRAY is not a locale map → untouched.
  // A non-localized field whose value is an object that LOOKS like a locale map is never inspected
  // (an inner Lexical object is never treated as locales) — schema position decides.
  const fields: Field[] = [
    { name: 'tags', type: 'text', hasMany: true, localized: true },
    { name: 'lexical', type: 'richText' }, // non-localized richtext, Lexical-shaped value
  ]
  const lexicalValue = { root: { type: 'root' }, message: 'Saved' }
  const data: Record<string, unknown> = {
    tags: ['a', 'b', 'c'],
    lexical: lexicalValue,
  }
  filterLocaleAllMaps(data, fields, ALLOWED_SET)
  assert.deepEqual(data.tags, ['a', 'b', 'c'], 'array value on localized field preserved')
  // The Lexical object is the value of a NON-localized field; the walker never reaches it as a
  // locale map, so its keys (`root`, `message` — neither in `allowed`) survive byte-for-byte.
  assert.deepEqual(data.lexical, lexicalValue, 'inner Lexical object never inspected as locales')
})

// ---------------------------------------------------------------------------
// Article block + commerce field + Tenants identity field — recursive coverage.
// ---------------------------------------------------------------------------

// A nested Article-style block: content is a `blocks` field whose `richText` block has a localized
// `richText` (Lexical) value, plus a localized `heading.text`. We verify pruning works at depth.
const articleBlockFields: Field[] = [
  { name: 'title', type: 'text', localized: true },
  {
    name: 'content',
    type: 'blocks',
    blocks: [
      {
        slug: 'richText',
        fields: [{ name: 'richText', type: 'richText', localized: true }],
      },
      {
        slug: 'heading',
        fields: [{ name: 'text', type: 'text', localized: true }],
      },
    ],
  },
]

test('filterLocaleAllMaps: nested Article block prunes locale-map keys at depth', () => {
  const lexicalAR = { root: { type: 'root' }, message: 'ar' }
  const lexicalES = { root: { type: 'root' }, message: 'es' }
  const data: Record<string, unknown> = {
    title: { [ALLOWED_LOCALE]: 't-A', [PRUNED_LOCALE]: 't-P' },
    content: [
      {
        blockType: 'richText',
        richText: { [ALLOWED_LOCALE]: lexicalAR, [PRUNED_LOCALE]: lexicalES },
      },
      { blockType: 'heading', text: { [ALLOWED_LOCALE]: 'h-A', [PRUNED_LOCALE]: 'h-P' } },
    ],
  }
  filterLocaleAllMaps(data, articleBlockFields, ALLOWED_SET)
  assert.equal((data.title as Record<string, unknown>)[PRUNED_LOCALE], undefined)
  const [richTextRow, headingRow] = data.content as Array<Record<string, unknown>>
  const rt = richTextRow.richText as Record<string, unknown>
  assert.deepEqual(rt[ALLOWED_LOCALE], lexicalAR, 'allowed Lexical value preserved')
  assert.equal(rt[PRUNED_LOCALE], undefined, 'pruned Lexical locale removed (outer key only)')
  assert.equal(
    (headingRow.text as Record<string, unknown>)[PRUNED_LOCALE],
    undefined,
    'nested block text pruned',
  )
})

test('stripLocalizedFieldsForConcreteLocale: nested Article block drops localized block fields', () => {
  const data: Record<string, unknown> = {
    title: 'X',
    content: [
      { blockType: 'richText', richText: { root: {} } },
      { blockType: 'heading', text: 'H' },
    ],
  }
  stripLocalizedFieldsForConcreteLocale(data, articleBlockFields)
  assert.equal('title' in data, false)
  const [richTextRow, headingRow] = data.content as Array<Record<string, unknown>>
  assert.equal('richText' in richTextRow, false)
  assert.equal('text' in headingRow, false)
  assert.equal(richTextRow.blockType, 'richText')
})

// A localized commerce-catalog field shape (store-products): a localized `name` + non-localized
// `sku`, with a localized `description` nested under a group.
const commerceFields: Field[] = [
  { name: 'name', type: 'text', localized: true },
  { name: 'sku', type: 'text' },
  {
    name: 'merchandising',
    type: 'group',
    fields: [{ name: 'description', type: 'textarea', localized: true }],
  },
]

test('enforceTenantLocales: a localized commerce field is pruned for locale=all and stripped for disallowed', async () => {
  const findByID = async () => ({ languages: ALLOWED_LANGS })
  const baseData = () => ({
    name: { [ALLOWED_LOCALE]: 'A', [PRUNED_LOCALE]: 'P' },
    sku: 'S',
    merchandising: { description: { [ALLOWED_LOCALE]: 'd-A', [PRUNED_LOCALE]: 'd-P' } },
    tenant: 1,
  })

  // locale=all → prune map keys, keep field.
  const allData = baseData()
  await enforceTenantLocales(commerceFields)({
    data: allData,
    originalDoc: {},
    req: { locale: 'all', payload: { findByID } },
  } as unknown as Parameters<CollectionBeforeChangeHook>[0])
  assert.equal((allData.name as Record<string, unknown>)[PRUNED_LOCALE], undefined)
  assert.equal((allData.name as Record<string, unknown>)[ALLOWED_LOCALE], 'A')
  assert.equal(
    ((allData.merchandising as Record<string, unknown>).description as Record<string, unknown>)[
      PRUNED_LOCALE
    ],
    undefined,
  )

  // disallowed concrete locale → strip the localized named fields entirely.
  const stripData = baseData()
  await enforceTenantLocales(commerceFields)({
    data: stripData,
    originalDoc: {},
    req: { locale: DISALLOWED_LOCALE, payload: { findByID } },
  } as unknown as Parameters<CollectionBeforeChangeHook>[0])
  assert.equal('name' in stripData, false)
  assert.equal(stripData.sku, 'S', 'non-localized commerce sibling preserved')
  assert.equal(
    'description' in (stripData.merchandising as Record<string, unknown>),
    false,
    'nested localized commerce field stripped',
  )
})

// A localized Tenants identity field slice (name + branding.tagline + a non-localized slug).
const tenantIdentityFields: Field[] = [
  { name: 'name', type: 'text', localized: true },
  { name: 'slug', type: 'text' },
  {
    name: 'branding',
    type: 'group',
    fields: [{ name: 'tagline', type: 'text', localized: true }],
  },
]

test('enforceTenantDocumentLocales: a localized Tenants identity field is pruned for locale=all and stripped for disallowed', async () => {
  const baseData = () => ({
    name: { [ALLOWED_LOCALE]: 'A', [PRUNED_LOCALE]: 'P' },
    slug: 's',
    branding: { tagline: { [ALLOWED_LOCALE]: 't-A', [PRUNED_LOCALE]: 't-P' } },
    languages: ALLOWED_LANGS,
  })

  // locale=all → prune map keys.
  const allData = baseData()
  enforceTenantDocumentLocales(tenantIdentityFields)({
    data: allData,
    originalDoc: {},
    req: { locale: 'all' },
  } as unknown as Parameters<CollectionBeforeChangeHook>[0])
  assert.equal((allData.name as Record<string, unknown>)[PRUNED_LOCALE], undefined)
  assert.equal(
    ((allData.branding as Record<string, unknown>).tagline as Record<string, unknown>)[
      PRUNED_LOCALE
    ],
    undefined,
  )

  // disallowed → strip localized named fields; slug preserved.
  const stripData = baseData()
  enforceTenantDocumentLocales(tenantIdentityFields)({
    data: stripData,
    originalDoc: {},
    req: { locale: DISALLOWED_LOCALE },
  } as unknown as Parameters<CollectionBeforeChangeHook>[0])
  assert.equal('name' in stripData, false)
  assert.equal(stripData.slug, 's')
  assert.equal('tagline' in (stripData.branding as Record<string, unknown>), false)
})

// ---------------------------------------------------------------------------
// Hook dispatch behavior — locale=all / allowed / disallowed / absent tenant.
// ---------------------------------------------------------------------------

test('enforceTenantDocumentLocales: a concrete ALLOWED locale persists unchanged', () => {
  const data: Record<string, unknown> = {
    name: { [ALLOWED_LOCALE]: 'A' },
    languages: ALLOWED_LANGS,
  }
  const before = JSON.parse(JSON.stringify(data))
  enforceTenantDocumentLocales(tenantIdentityFields)({
    data,
    originalDoc: {},
    req: { locale: ALLOWED_LOCALE },
  } as unknown as Parameters<CollectionBeforeChangeHook>[0])
  assert.deepEqual(data, before, 'allowed concrete locale writes are a no-op')
})

test('enforceTenantLocales: a concrete ALLOWED locale persists unchanged (no DB filter needed)', async () => {
  const findByID = async () => ({ languages: ALLOWED_LANGS })
  const data: Record<string, unknown> = {
    name: { [ALLOWED_LOCALE]: 'A' },
    tenant: 1,
  }
  const before = JSON.parse(JSON.stringify(data))
  await enforceTenantLocales(tenantIdentityFields)({
    data,
    originalDoc: {},
    req: { locale: ALLOWED_LOCALE, payload: { findByID } },
  } as unknown as Parameters<CollectionBeforeChangeHook>[0])
  assert.deepEqual(data, before)
})

test('enforceTenantLocales: throws 400 when neither data.tenant nor originalDoc.tenant is present', async () => {
  const findByID = async () => ({ languages: ALLOWED_LANGS })
  await assert.rejects(
    () =>
      enforceTenantLocales(tenantIdentityFields)({
        data: { name: { [ALLOWED_LOCALE]: 'A' } },
        originalDoc: {},
        req: { locale: ALLOWED_LOCALE, payload: { findByID } },
      } as unknown as Parameters<CollectionBeforeChangeHook>[0]),
    (err: unknown) => {
      assert.equal((err as { status?: number }).status, 400)
      return true
    },
  )
})

test('enforceTenantLocales: throws 500 when the tenant has no catalogue-allowed languages', async () => {
  // Stored invariant violation: tenant row exists but languages is empty / all unknown codes.
  const findByID = async () => ({ languages: [] })
  await assert.rejects(
    () =>
      enforceTenantLocales(tenantIdentityFields)({
        data: { name: { [ALLOWED_LOCALE]: 'A' }, tenant: 1 },
        originalDoc: {},
        req: { locale: ALLOWED_LOCALE, payload: { findByID } },
      } as unknown as Parameters<CollectionBeforeChangeHook>[0]),
    (err: unknown) => {
      assert.equal((err as { status?: number }).status, 500)
      return true
    },
  )
})

test('enforceTenantLocales: undefined locale is treated as DISALLOWED and strips localized fields', async () => {
  // Payload supplies the configured default when a Local API caller omits locale, so `undefined`
  // reaching this hook means a disallowed caller — strip rather than guess.
  const findByID = async () => ({ languages: ALLOWED_LANGS })
  const data: Record<string, unknown> = {
    name: { [ALLOWED_LOCALE]: 'A' },
    slug: 's',
    tenant: 1,
  }
  await enforceTenantLocales(tenantIdentityFields)({
    data,
    originalDoc: {},
    req: { locale: undefined, payload: { findByID } },
  } as unknown as Parameters<CollectionBeforeChangeHook>[0])
  assert.equal('name' in data, false)
  assert.equal(data.slug, 's')
})

test('enforceTenantLocales: resolves tenant from originalDoc when data.tenant is absent (update path)', async () => {
  let lookedUpID: unknown = null
  const findByID = async ({ id }: { id: unknown }) => {
    lookedUpID = id
    return { languages: ALLOWED_LANGS }
  }
  const data: Record<string, unknown> = { name: { [ALLOWED_LOCALE]: 'A' } }
  await enforceTenantLocales(tenantIdentityFields)({
    data,
    originalDoc: { tenant: 42 },
    req: { locale: ALLOWED_LOCALE, payload: { findByID } },
  } as unknown as Parameters<CollectionBeforeChangeHook>[0])
  assert.equal(lookedUpID, '42', 'tenant id stringified from originalDoc on partial update')
})

// ---------------------------------------------------------------------------
// Hook ORDER — assert plugin registers enforceTenantLocales AFTER enforceSelectedTenant,
// and Tenants wires enforceTenantDocumentLocales AFTER validateTenantLanguages.
// Inspect the constructed hook arrays directly — no Payload boot.
// ---------------------------------------------------------------------------

test('plugin: enforceTenantLocales is registered AFTER enforceSelectedTenant and after any existing beforeChange hook', () => {
  const existingHook: CollectionBeforeChangeHook = () => ({}) as unknown
  // A minimal config with one tenant-scoped, localized collection. The plugin loop finds it by slug
  // ('articles' is in TENANT_COLLECTION_FEATURES) and mutates hooks/access in place.
  const config = {
    collections: [
      {
        slug: 'articles',
        access: {},
        hooks: { beforeChange: [existingHook] },
        fields: [
          { name: 'tenant', type: 'relationship', relationTo: 'tenants' },
          { name: 'title', type: 'text', localized: true },
        ],
        admin: {},
      },
    ],
  } as unknown as Config

  tenantFeatureAccessPlugin()(config)

  const collection = config.collections![0]
  const hooks = collection.hooks!.beforeChange!
  // [existing, enforceSelectedTenant, enforceTenantLocales]
  assert.equal(hooks.length, 3)
  assert.equal(hooks[0], existingHook, 'caller-supplied existing hook stays first')

  // hooks[1] behaves as enforceSelectedTenant: with no req.user, it short-circuits and returns data.
  const tenantHookResult = hooks[1]({
    data: { title: 'x' },
    operation: 'create',
    req: { user: null },
  } as unknown as Parameters<CollectionBeforeChangeHook>[0])
  assert.ok(tenantHookResult instanceof Promise || typeof tenantHookResult === 'object')

  // hooks[2] behaves as enforceTenantLocales: with no tenant on the document it throws 400 — the
  // signature behavior of the locale hook, distinct from the tenant-injection hook above.
  assert.rejects(
    () =>
      hooks[2]({
        data: { title: 'x' },
        req: {},
      } as unknown as Parameters<CollectionBeforeChangeHook>[0]),
    (err: unknown) => (err as { status?: number }).status === 400,
  )
})

test('plugin: a collection with NO reachable localized field gets only enforceSelectedTenant', () => {
  const config = {
    collections: [
      {
        slug: 'articles',
        access: {},
        hooks: {},
        fields: [
          { name: 'tenant', type: 'relationship', relationTo: 'tenants' },
          { name: 'views', type: 'number' }, // no localized field anywhere
        ],
        admin: {},
      },
    ],
  } as unknown as Config

  tenantFeatureAccessPlugin()(config)
  const hooks = config.collections![0].hooks!.beforeChange!
  assert.equal(hooks.length, 1, 'no localized field → locale hook not registered')
})

test('Tenants: beforeChange wires enforceTenantDocumentLocales AFTER validateTenantLanguages', () => {
  // Imported `validateTenantLanguages` is the same function reference installed at slot 2.
  const hooks = (Tenants.hooks as { beforeChange: CollectionBeforeChangeHook[] }).beforeChange
  assert.equal(hooks.length, 4)
  assert.equal(hooks[2], validateTenantLanguages as CollectionBeforeChangeHook, 'validation at slot 2')

  // The hook at slot 3 behaves as enforceTenantDocumentLocales: with locale='all' it prunes the
  // locale-map keys of a localized Tenant identity field rather than throwing.
  const data: Record<string, unknown> = {
    name: { [ALLOWED_LOCALE]: 'A', [PRUNED_LOCALE]: 'P' },
    languages: ALLOWED_LANGS,
  }
  hooks[3]({
    data,
    originalDoc: {},
    req: { locale: 'all' },
  } as unknown as Parameters<CollectionBeforeChangeHook>[0])
  assert.equal(
    (data.name as Record<string, unknown>)[PRUNED_LOCALE],
    undefined,
    'slot-3 hook prunes locale-map keys — it is enforceTenantDocumentLocales',
  )
  assert.equal(
    (data.name as Record<string, unknown>)[ALLOWED_LOCALE],
    'A',
    'allowed locale preserved',
  )
})
