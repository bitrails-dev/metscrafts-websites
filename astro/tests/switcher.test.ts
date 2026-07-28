// T10 — language switcher (§9 + §2.5). Asserts the shared pure helper that all three
// switcher surfaces (TheTopBar.astro / TheSidebar.vue / PortalNav.vue) consume, plus the
// canonical visibility predicate (`links.length > 1`). No redeclared locale literals.
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  LOCALES,
  UNPREFIXED_LOCALE,
  languageSwitchLinks,
  switchLocalePath,
  stripLocalePrefix,
  type Locale,
} from '../src/i18n/index'

const AR = LOCALES[0] // unprefixed default
const PREFIXED = LOCALES.filter((l) => l !== UNPREFIXED_LOCALE)
const FIRST_PREFIXED = PREFIXED[0]

test('returns exactly one entry per supplied language, in the supplied order', () => {
  const supplied: Locale[] = PREFIXED.length >= 2 ? [PREFIXED[1], AR, PREFIXED[0]] : [AR, FIRST_PREFIXED]
  const links = languageSwitchLinks('/departments', '', supplied)
  assert.deepEqual(
    links.map((l) => l.locale),
    supplied,
  )
})

test('every link href is `switchLocalePath(pathname, search, locale)` (canonical builder)', () => {
  const langs = LOCALES as Locale[]
  const links = languageSwitchLinks('/departments', '?p=1', langs)
  for (const link of links) {
    assert.equal(link.href, switchLocalePath('/departments', '?p=1', link.locale))
  }
})

test('preserves the querystring on every link', () => {
  const links = languageSwitchLinks('/departments', '?page=2&x=y', LOCALES as Locale[])
  for (const link of links) {
    assert.ok(
      link.href.endsWith('?page=2&x=y'),
      `${link.locale} href ${link.href} should preserve the querystring`,
    )
  }
})

test('removes an existing prefix without a fixed-width regex (works for every catalogue locale)', () => {
  // Switching FROM any prefixed path TO every catalogue locale yields exactly one prefix
  // (or none for the unprefixed default) — never a doubled or stale prefix.
  for (const fromLocale of PREFIXED) {
    const links = languageSwitchLinks(`/${fromLocale}/departments`, '', LOCALES as Locale[])
    for (const link of links) {
      const expected =
        link.locale === UNPREFIXED_LOCALE ? '/departments' : `/${link.locale}/departments`
      assert.equal(
        link.href,
        expected,
        `switching /${fromLocale}/departments → ${link.locale} produced wrong href`,
      )
    }
  }
})

test('switching the unprefixed root yields `/` for the default and `/<locale>/` for prefixed locales', () => {
  const links = languageSwitchLinks('/', '', LOCALES as Locale[])
  const map = Object.fromEntries(links.map((l) => [l.locale, l.href])) as Record<Locale, string>
  assert.equal(map[AR], '/')
  for (const locale of PREFIXED) {
    assert.equal(map[locale], `/${locale}/`)
  }
})

test('visibility predicate is links.length > 1 (single-language tenant hides the switcher)', () => {
  const single = languageSwitchLinks('/departments', '', [AR])
  assert.equal(single.length > 1, false, 'single-language tenant must hide the switcher')
  const multi = languageSwitchLinks('/departments', '', [AR, FIRST_PREFIXED])
  assert.equal(multi.length > 1, true, 'multi-language tenant must show the switcher')
})

test('switching to the locale already in the URL is idempotent (no prefix stripping side effects)', () => {
  for (const locale of LOCALES) {
    const path = locale === UNPREFIXED_LOCALE ? '/about' : `/${locale}/about`
    const links = languageSwitchLinks(path, '?x=1', LOCALES as Locale[])
    const self = links.find((l) => l.locale === locale)!
    assert.equal(self.href, path + '?x=1')
  }
})

test('stripLocalePrefix leaves a non-prefixed path untouched (drives the switcher, not a regex)', () => {
  assert.equal(stripLocalePrefix('/departments'), '/departments')
  assert.equal(stripLocalePrefix('/'), '/')
})
