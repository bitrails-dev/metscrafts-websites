// T9 — locale-redirect A/B/C matrix + querystring preservation + unsupported → default (§9).
// Asserts the pure `computeLocaleRedirect` helper that `middleware.ts` invokes between the
// tenant-resolve and the healthcare-settings fetch. All locale codes are derived from the
// exported catalogue arrays; no redeclared literals.
import assert from 'node:assert/strict'
import test from 'node:test'

import { LOCALES, UNPREFIXED_LOCALE, type Locale } from '../src/i18n/index'
import { computeLocaleRedirect, hasUnknownLocalePrefix } from '../src/lib/feature-routes'

// Destructure positions, not literal codes. LOCALES[0] is the unprefixed default by invariant.
const AR = LOCALES[0] // unprefixed default locale
const FIRST_PREFIXED = LOCALES.find((l) => l !== UNPREFIXED_LOCALE)!
const LAST = LOCALES[LOCALES.length - 1]
assert.ok(FIRST_PREFIXED, 'catalogue must expose at least one prefixed locale')

// A: single-language tenant (default-locale only).
const TENANT_A = { languages: [AR] as Locale[], defaultLanguage: AR as Locale }
// B: default + the first prefixed locale.
const TENANT_B = { languages: [AR, FIRST_PREFIXED] as Locale[], defaultLanguage: AR as Locale }
// C: every catalogue locale.
const TENANT_C = { languages: LOCALES as Locale[], defaultLanguage: AR as Locale }

test('A: tenant allowing only the unprefixed default redirects a prefixed-locale request to the default', () => {
  const dest = computeLocaleRedirect(`/${FIRST_PREFIXED}/departments`, '', TENANT_A.languages, TENANT_A.defaultLanguage)
  assert.equal(dest, '/departments')
})

test('B: tenant allowing [default, firstPrefixed] keeps the prefixed request (no redirect)', () => {
  const dest = computeLocaleRedirect(`/${FIRST_PREFIXED}/departments`, '', TENANT_B.languages, TENANT_B.defaultLanguage)
  assert.equal(dest, null)
})

test('C: tenant allowing every catalogue locale keeps the last-locale request (no redirect)', () => {
  const dest = computeLocaleRedirect(`/${LAST}/departments`, '', TENANT_C.languages, TENANT_C.defaultLanguage)
  assert.equal(dest, null)
})

test('bare prefixed root redirects to the tenant-default root for every prefixed LOCALES entry', () => {
  for (const locale of LOCALES) {
    if (locale === UNPREFIXED_LOCALE) continue
    const dest = computeLocaleRedirect(`/${locale}`, '', TENANT_A.languages, TENANT_A.defaultLanguage)
    assert.equal(dest, '/')
  }
})

test('trailing-slash prefixed root redirects to the tenant-default root', () => {
  const dest = computeLocaleRedirect(`/${FIRST_PREFIXED}/`, '', TENANT_A.languages, TENANT_A.defaultLanguage)
  assert.equal(dest, '/')
})

test('querystring is preserved on redirect (?page=2)', () => {
  const dest = computeLocaleRedirect(`/${FIRST_PREFIXED}/articles`, '?page=2', TENANT_A.languages, TENANT_A.defaultLanguage)
  assert.equal(dest, '/articles?page=2')
})

test('querystring is preserved on the bare prefixed root redirect (?page=2)', () => {
  const dest = computeLocaleRedirect(`/${FIRST_PREFIXED}`, '?page=2', TENANT_A.languages, TENANT_A.defaultLanguage)
  assert.equal(dest, '/?page=2')
})

test('unsupported locale redirects to the tenant default', () => {
  // Tenant B allows only [AR, FIRST_PREFIXED]; the last catalogue locale is unsupported.
  const dest = computeLocaleRedirect(`/${LAST}/departments`, '', TENANT_B.languages, TENANT_B.defaultLanguage)
  assert.equal(dest, '/departments')
})

test('default-locale root never redirects for a tenant that includes the default', () => {
  for (const tenant of [TENANT_A, TENANT_B, TENANT_C]) {
    const dest = computeLocaleRedirect('/', '', tenant.languages, tenant.defaultLanguage)
    assert.equal(dest, null)
  }
})

test('when the supplied default is itself outside the language set, def falls back to languages[0]', () => {
  // Edge case mirroring middleware's `tenant.defaultLanguage ?? tenant.languages[0]`:
  // pass a default that is NOT in `languages` — the helper must pick languages[0].
  const dest = computeLocaleRedirect(`/${FIRST_PREFIXED}/departments`, '', [AR] as Locale[], LAST)
  assert.equal(dest, '/departments')
})

test('non-content paths never trigger a redirect (admin/api/static/assets/uploads)', () => {
  const nonContent = [
    '/_astro/main.abc.js',
    '/_image',
    '/admin',
    '/admin/users',
    '/api',
    '/api/store',
    '/api/foo/bar',
    '/uploads/photo.jpg',
    '/uploads/sub/photo.jpg',
    '/logo/logo-hex.svg',
    '/images/og-default.svg',
    '/favicon.svg',
    '/icon.png',
    '/robots.txt',
    '/site.webmanifest',
  ]
  for (const p of nonContent) {
    const dest = computeLocaleRedirect(p, '?x=1', TENANT_C.languages, TENANT_C.defaultLanguage)
    assert.equal(dest, null, `${p} should not redirect`)
  }
})

test('an empty language set never redirects', () => {
  const dest = computeLocaleRedirect(`/${FIRST_PREFIXED}/departments`, '', [] as Locale[], AR)
  assert.equal(dest, null)
})

test('unknown locale-shaped prefixes are rejected before tenant redirect handling', () => {
  assert.equal(hasUnknownLocalePrefix('/fr/about'), true)
  assert.equal(hasUnknownLocalePrefix('/FR/about'), true)
  assert.equal(hasUnknownLocalePrefix('/fr'), true)
  assert.equal(hasUnknownLocalePrefix(`/${FIRST_PREFIXED}/about`), false)
  assert.equal(hasUnknownLocalePrefix('/about'), false)
  assert.equal(hasUnknownLocalePrefix('/api/fr/about'), false)
})
