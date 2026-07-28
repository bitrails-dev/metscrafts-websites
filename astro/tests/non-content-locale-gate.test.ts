// T15 — non-content locale gate (§9). `isContentPath` decides whether the middleware's
// locale-enforcement block considers a path a content route. Dashboard/API/static/asset
// prefixes plus the four public-root files bypass enforcement; `/` and prefixed/unprefixed
// content routes are gated. No redeclared locale literals.
import assert from 'node:assert/strict'
import test from 'node:test'

import { LOCALES, UNPREFIXED_LOCALE } from '../src/i18n/index'
import { isContentPath } from '../src/lib/feature-routes'

const NON_CONTENT = [
  // Public-root static files (exact match).
  '/favicon.svg',
  '/icon.png',
  '/robots.txt',
  '/site.webmanifest',
  // Dashboard / API.
  '/admin',
  '/admin/users',
  '/api',
  '/api/store',
  '/api/foo/bar',
  // Astro / Next internal prefixes.
  '/_astro/main.abc123.js',
  '/_astro/style.css',
  '/_next/static/chunk.js',
  '/_image',
  // Media / uploads / brand assets.
  '/uploads',
  '/uploads/photo.jpg',
  '/uploads/deep/nested/photo.jpg',
  '/logo',
  '/logo/logo-hex.svg',
  '/images',
  '/images/og-default.svg',
]

test('isContentPath is false for every non-content path', () => {
  for (const p of NON_CONTENT) {
    assert.equal(isContentPath(p), false, `${p} should be non-content`)
  }
})

test('isContentPath is true for /', () => {
  assert.equal(isContentPath('/'), true)
})

test('isContentPath is true for prefixed and unprefixed content routes', () => {
  const bodies = [
    'departments', 'team', 'doctors', 'articles', 'events', 'awards',
    'achievements', 'testimonials', 'portal', 'shop', 'cart', 'checkout',
    'account', 'about', 'contact',
  ]
  for (const locale of LOCALES) {
    const prefix = locale === UNPREFIXED_LOCALE ? '' : `/${locale}`
    for (const body of bodies) {
      assert.equal(isContentPath(`${prefix}/${body}`), true, `${prefix}/${body} should be content`)
      assert.equal(isContentPath(`${prefix}/${body}/sub`), true, `${prefix}/${body}/sub should be content`)
      assert.equal(isContentPath(`${prefix}/${body}/`), true, `${prefix}/${body}/ trailing slash should be content`)
    }
  }
})

test('a path that merely starts with a non-content prefix word is treated as content (/uploadsX)', () => {
  // The prefix matcher requires either exact equality or a `/`-separated child, so a path
  // that shares leading characters but is not actually a descendant remains a content route.
  for (const p of ['/uploadsX', '/imagesX', '/logoX', '/apiX', '/_astroX', '/_imageX', '/adminX']) {
    assert.equal(isContentPath(p), true, `${p} should be content (not a real prefix root)`)
  }
})

test('isContentPath operates on the pathname only — callers strip the querystring first', () => {
  // The middleware passes `context.url.pathname` (no `?…`); documenting that contract here so
  // a caller that mistakenly passes a full URL with a querystring is caught at review time.
  assert.equal(isContentPath('/_image'), false)
  assert.equal(isContentPath('/departments?page=2'), true) // would-be non-content is content if URL is passed verbatim
})

test('exact prefix roots are non-content (equality branch)', () => {
  for (const p of ['/admin', '/api', '/_next', '/_astro', '/_image', '/uploads', '/logo', '/images']) {
    assert.equal(isContentPath(p), false, `${p} exact should be non-content`)
  }
})
