// T1 — frontend/CMS locale catalogue parity (§9 of the per-tenant-languages plan).
// All locale codes are derived from the exported catalogue arrays; no inline "ar"/"en"/"es" literals.
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  LOCALES,
  DEFAULT_LOCALE,
  FALLBACK_LANGUAGES,
  RTL_LOCALES,
  OG_LOCALE_TAGS,
  HREFLANG_TAGS,
  DATE_LOCALE_TAGS,
} from '../src/i18n/index'
import {
  PLATFORM_LOCALE_CODES,
  DEFAULT_PLATFORM_LOCALE,
  FALLBACK_PLATFORM_LANGUAGES,
  RTL_PLATFORM_LOCALES,
} from '../../cms/src/collections/tenantLocales'

const TWO_LETTER = /^[a-z]{2}$/

const sorted = <T>(xs: readonly T[]) => [...xs].sort() as T[]
const setAsSortedArray = <T>(s: ReadonlySet<T>): T[] => sorted([...s])

test('frontend LOCALES and CMS PLATFORM_LOCALE_CODES are identical, in order', () => {
  assert.deepEqual(LOCALES, PLATFORM_LOCALE_CODES)
})

test('every catalogue code is a lowercase two-letter ISO-639-1 code', () => {
  for (const code of LOCALES) assert.match(code, TWO_LETTER)
  for (const code of PLATFORM_LOCALE_CODES) assert.match(code, TWO_LETTER)
})

test('RTL_LOCALES is a subset of LOCALES and matches the CMS RTL set', () => {
  for (const code of RTL_LOCALES) assert.ok(LOCALES.includes(code), `rtl code ${code} missing from LOCALES`)
  assert.deepEqual(setAsSortedArray(RTL_LOCALES), setAsSortedArray(RTL_PLATFORM_LOCALES))
})

test('OG, hreflang, and date tag maps cover exactly LOCALES with non-empty values', () => {
  for (const map of [OG_LOCALE_TAGS, HREFLANG_TAGS, DATE_LOCALE_TAGS]) {
    assert.deepEqual(sorted(Object.keys(map)), sorted(LOCALES))
    for (const code of LOCALES) {
      const tag = (map as Record<string, string>)[code]
      assert.equal(typeof tag, 'string')
      assert.ok(tag.length > 0, `empty tag for ${code}`)
    }
  }
})

test('frontend and CMS default + fallback constants are non-empty, catalogue-scoped, and include their package default', () => {
  // non-empty
  assert.ok(FALLBACK_LANGUAGES.length > 0)
  assert.ok(FALLBACK_PLATFORM_LANGUAGES.length > 0)

  // every fallback code is a catalogue member
  for (const code of FALLBACK_LANGUAGES) assert.ok(LOCALES.includes(code), `frontend fallback ${code} not in LOCALES`)
  for (const code of FALLBACK_PLATFORM_LANGUAGES) assert.ok(PLATFORM_LOCALE_CODES.includes(code), `cms fallback ${code} not in PLATFORM_LOCALE_CODES`)

  // each package default is a fallback member (invariant the catalogue self-asserts on load)
  assert.ok(FALLBACK_LANGUAGES.includes(DEFAULT_LOCALE))
  assert.ok(FALLBACK_PLATFORM_LANGUAGES.includes(DEFAULT_PLATFORM_LOCALE))

  // cross-package parity of the default and the fallback set
  assert.equal(DEFAULT_LOCALE, DEFAULT_PLATFORM_LOCALE)
  assert.deepEqual(sorted(FALLBACK_LANGUAGES), sorted(FALLBACK_PLATFORM_LANGUAGES))
})
