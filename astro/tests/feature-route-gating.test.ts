// T8 — catalogue-derived feature-route gating (§9 of the per-tenant-languages plan).
// The whole locale prefix is OPTIONAL (not fixed-width): /departments, /en/departments,
// /es/departments all match, but /endepartments-style concatenations do NOT. Adding a
// catalogue row automatically expands the loops below. No redeclared locale literals —
// every code is derived from exported catalogue arrays.
import assert from 'node:assert/strict'
import test from 'node:test'

import { LOCALES, UNPREFIXED_LOCALE } from '../src/i18n/index'
import { buildFeatureRoutes } from '../src/lib/feature-routes'

const ROUTES = buildFeatureRoutes(LOCALES, UNPREFIXED_LOCALE)
const PREFIXED = LOCALES.filter((l) => l !== UNPREFIXED_LOCALE)

// Map each capability to its route body/ies. Uses the same body strings the builder emits.
const FEATURE_BODIES: Record<string, string[]> = {
  departments: ['departments'],
  team: ['team', 'doctors'],
  articles: ['articles'],
  events: ['events'],
  awards: ['awards'],
  achievements: ['achievements'],
  testimonials: ['testimonials'],
  portal: ['portal'],
  commerce: ['shop', 'cart', 'checkout', 'account'],
}

const rulesFor = (feature: string) => ROUTES.filter(([, f]) => f === feature)

test('the builder produced one rule per feature in the canonical feature set', () => {
  // Sanity: the catalogue-derived builder emits exactly the capabilities we assert below.
  const features = new Set(ROUTES.map(([, f]) => f))
  for (const feature of Object.keys(FEATURE_BODIES)) {
    assert.ok(features.has(feature), `expected a rule for feature ${feature}`)
  }
})

test('every feature regex matches the unprefixed (default-locale) route for each body', () => {
  for (const [feature, bodies] of Object.entries(FEATURE_BODIES)) {
    const rules = rulesFor(feature)
    assert.ok(rules.length > 0, `no rule for feature ${feature}`)
    for (const body of bodies) {
      const path = `/${body}`
      assert.ok(
        rules.some(([re]) => re.test(path)),
        `unprefixed ${path} should match feature ${feature}`,
      )
    }
  }
})

test('every feature regex matches the correctly-prefixed route for every prefixed LOCALES entry', () => {
  assert.ok(PREFIXED.length > 0, 'catalogue should expose at least one prefixed locale')
  for (const locale of PREFIXED) {
    for (const [feature, bodies] of Object.entries(FEATURE_BODIES)) {
      const rules = rulesFor(feature)
      for (const body of bodies) {
        const path = `/${locale}/${body}`
        assert.ok(
          rules.some(([re]) => re.test(path)),
          `${path} should match feature ${feature}`,
        )
      }
    }
  }
})

test('concatenations like /endepartments do NOT match any feature route (whole-prefix optional, not fixed-width)', () => {
  // For every prefixed locale code, sliding it directly against a body must fail because
  // the regex requires the prefix to be followed by `/`.
  for (const locale of PREFIXED) {
    for (const [feature, bodies] of Object.entries(FEATURE_BODIES)) {
      for (const body of bodies) {
        const concatenated = `/${locale}${body}` // e.g. /endepartments, /esdepartments
        for (const [re, f] of ROUTES) {
          assert.ok(
            !re.test(concatenated),
            `${concatenated} must NOT match feature ${f} (matched ${feature} rule)`,
          )
        }
      }
    }
  }
})

test('trailing-slash and deeper sub-paths still match (boundary is `(?:/|$)`)', () => {
  for (const locale of LOCALES) {
    const prefix = locale === UNPREFIXED_LOCALE ? '' : `/${locale}`
    for (const suffix of ['/departments/', '/departments/some-doctor', '/articles/page/2']) {
      const path = `${prefix}${suffix}`
      assert.ok(ROUTES.some(([re]) => re.test(path)), `${path} should match some feature`)
    }
  }
})

test('an unknown body never matches, prefixed or not', () => {
  for (const locale of LOCALES) {
    const prefix = locale === UNPREFIXED_LOCALE ? '' : `/${locale}`
    const path = `${prefix}/this-is-not-a-feature`
    for (const [re, feature] of ROUTES) {
      assert.ok(!re.test(path), `${path} must NOT match feature ${feature}`)
    }
  }
})
