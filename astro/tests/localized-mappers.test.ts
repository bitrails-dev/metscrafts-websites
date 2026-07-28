// T7 — localized mappers emit locale maps; pickLocalized honors the launch-catalogue case and a
// non-unprefixed-only tenant set (§9 of the per-tenant-languages plan).
//
// NO locale codes are redeclared here. Every code is pulled from `LOCALES` / `FALLBACK_LANGUAGES`
// so adding a catalogue row flows through unchanged. The bound `[unprefixed, fallback, third]`
// triple is the launch-catalogue probe: index 0 is the unprefixed routing default, index 1 is a
// fallback language, index 2 is the empty-cell probe.
import assert from 'node:assert/strict'
import test from 'node:test'

import { LOCALES, FALLBACK_LANGUAGES, pickLocalized } from '../src/i18n/index'
import { makeGetCollection } from '../src/cms/shared/map'
import { normalizeBlocks } from '../src/cms/shared/blocks'
import { normalizeHealthcareSettings } from '../src/cms/shared/healthcare-settings'

// Required binding.
const [unprefixed, fallback, third] = LOCALES

// A localized payload field under `locale=all&fallback-locale=none` — one entry per catalogue
// locale. Indices align with LOCALES so callers never hard-code a code.
const localizedField = (vals: string[]) =>
  Object.fromEntries(LOCALES.map((code, i) => [code, vals[i] ?? '']))

test('launch-catalogue binding is well-formed', () => {
  assert.ok(LOCALES.length >= 3, 'catalogue must have at least three entries for the T7 binding')
  assert.ok(FALLBACK_LANGUAGES.includes(fallback), 'second row must be a fallback language')
  assert.notEqual(third, unprefixed)
  assert.notEqual(third, fallback)
})

// --- pickLocalized invariants ---

test('pickLocalized returns "" when lang and default are both empty (launch case)', () => {
  // Launch catalogue {unprefixed:"x", fallback:"", third:""}, lang=third, default=fallback.
  // The unprefixed value must NOT leak: requested lang is empty, tenantDefault is empty too.
  assert.equal(pickLocalized({ [unprefixed]: 'x', [fallback]: '', [third]: '' }, third, fallback), '')
})

test('pickLocalized returns the non-empty default when the requested lang is empty', () => {
  assert.equal(pickLocalized({ [unprefixed]: 'x', [fallback]: 'VAL', [third]: '' }, third, fallback), 'VAL')
})

test('pickLocalized never surfaces an unprefixed value from a non-unprefixed-only map', () => {
  // Tenant set = everything except the unprefixed locale. A map built from it has no unprefixed
  // key, so A7-safe pick (lang → tenantDefault → "") can never return the unprefixed value.
  const nonUnprefixed = LOCALES.filter((l) => l !== unprefixed)
  const map = Object.fromEntries(nonUnprefixed.map((code) => [code, `v-${code}`]))
  assert.ok(!(unprefixed in map), 'fixture must not include the unprefixed key')
  const allowed = new Set<string>(['', ...Object.values(map)])
  for (const lang of LOCALES) {
    const v = pickLocalized(map, lang, fallback)
    assert.ok(allowed.has(v), `lang=${lang} returned "${v}" which is outside the non-unprefixed map`)
    assert.notEqual(v, `v-${unprefixed}`, `lang=${lang} leaked the unprefixed value`)
  }
})

// --- map.ts emits locale maps; …Ar siblings are dropped ---

test('map.ts articles mapper emits a title map and drops titleAr', async () => {
  const getCollection = makeGetCollection(
    async () => [{ id: 'a1', slug: 'a1', title: localizedField(['T-1', 'T-2', 'T-3']) }],
    () => undefined,
  )
  const [entry] = await getCollection('articles')
  assert.equal(typeof entry.data.title, 'object')
  assert.equal(entry.data.titleAr, undefined)
  assert.deepEqual(Object.keys(entry.data.title).sort(), [...LOCALES].sort())
})

test('map.ts testimonials mapper emits name/quote/caseType maps and drops their …Ar siblings', async () => {
  const getCollection = makeGetCollection(
    async () => [{
      id: 't1', slug: 't1',
      name: localizedField(['n-1', 'n-2', 'n-3']),
      quote: localizedField(['q-1', 'q-2', 'q-3']),
      caseType: localizedField(['c-1', 'c-2', 'c-3']),
    }],
    () => undefined,
  )
  const [entry] = await getCollection('testimonials')
  for (const field of ['name', 'quote', 'caseType'] as const) {
    assert.equal(typeof entry.data[field], 'object', `${field} must be a map`)
    assert.equal(entry.data[`${field}Ar`], undefined, `${field}Ar must be dropped`)
  }
})

// --- blocks.ts emits locale maps ---

test('blocks.ts heading block emits a text map and drops textAr', () => {
  const [block] = normalizeBlocks(
    [{ blockType: 'heading', level: 'h2', text: localizedField(['H-1', 'H-2', 'H-3']) }],
    () => undefined,
  )
  assert.equal(block.type, 'heading')
  assert.equal(typeof (block as any).text, 'object')
  assert.equal((block as any).textAr, undefined)
})

test('blocks.ts image block emits alt/caption maps and drops the …Ar siblings', () => {
  const [block] = normalizeBlocks(
    [{
      blockType: 'image',
      image: undefined,
      alt: localizedField(['a-1', 'a-2', 'a-3']),
      caption: localizedField(['cap-1', 'cap-2', 'cap-3']),
    }],
    () => undefined,
  )
  assert.equal(block.type, 'image')
  assert.equal(typeof (block as any).alt, 'object')
  assert.equal(typeof (block as any).caption, 'object')
  assert.equal((block as any).altAr, undefined)
  assert.equal((block as any).captionAr, undefined)
})

test('blocks.ts richText block pre-renders Lexical HTML per catalogue locale into a map', () => {
  // Minimal Lexical tree each locale ships: one paragraph wrapping a single text node.
  const tree = (text: string) => ({
    root: {
      type: 'root', format: '', indent: 0, version: 1, direction: 'ltr',
      children: [{
        type: 'paragraph', format: '', indent: 0, version: 1, direction: 'ltr',
        textFormat: 0, textStyle: true,
        children: [{ type: 'text', format: 0, mode: 'normal', style: '', detail: 0, version: 1, text }],
      }],
    },
  })
  const richText = Object.fromEntries(LOCALES.map((code, i) => [code, tree(`body-${i}`)]))
  const [block] = normalizeBlocks([{ blockType: 'richText', richText }], () => undefined)
  assert.equal(block.type, 'richText')
  const html = (block as any).html as Record<string, string>
  assert.equal(typeof html, 'object')
  assert.equal((block as any).htmlAr, undefined)
  assert.deepEqual(Object.keys(html).sort(), [...LOCALES].sort())
  // Pre-render is per-locale: html[code] must come from code's own tree, not a first-available leak.
  for (const code of Object.keys(html)) {
    const i = ([...LOCALES] as string[]).indexOf(code)
    assert.ok(html[code].includes(`body-${i}`), `html for ${code} did not come from its own Lexical tree`)
  }
})

// --- healthcare-settings.ts emits locale maps ---

test('healthcare-settings.ts stat emits value/unit maps and drops valueAr/unitAr', () => {
  const vm = normalizeHealthcareSettings({
    emergencyNumber: '123',
    hero: {
      years: {
        value: localizedField(['1', '2', '3']),
        unit: localizedField(['u1', 'u2', 'u3']),
      },
    },
  })
  const years = vm.stats.years as any
  assert.equal(typeof years.value, 'object')
  assert.equal(typeof years.unit, 'object')
  assert.equal(years.valueAr, undefined)
  assert.equal(years.unitAr, undefined)
  assert.equal(years.value[third], '3')
})
