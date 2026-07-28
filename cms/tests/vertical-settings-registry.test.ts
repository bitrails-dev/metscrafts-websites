import assert from 'node:assert/strict'
import test from 'node:test'
import {
  VERTICAL_SETTINGS,
  verticalSettingsCollections,
  verticalSettingsFeatureMap,
} from '../src/verticals/registry'

test('every settings collection has a unique slug', () => {
  const slugs = VERTICAL_SETTINGS.map(({ config }) => config.slug)
  assert.equal(new Set(slugs).size, slugs.length)
})

test('the registry is exactly commerce-settings→commerce and healthcare-settings→healthcare', () => {
  assert.deepEqual(
    VERTICAL_SETTINGS.map(({ config, feature }) => ({ slug: config.slug, feature })),
    [
      { slug: 'commerce-settings', feature: 'commerce' },
      { slug: 'healthcare-settings', feature: 'healthcare' },
    ],
  )
})

test('verticalSettingsCollections is the multi-tenant slug-keyed map', () => {
  assert.deepEqual(verticalSettingsCollections, {
    'commerce-settings': {},
    'healthcare-settings': {},
  })
})

test('the feature map marks every settings collection tenant-scoped with its feature', () => {
  assert.deepEqual(verticalSettingsFeatureMap, {
    'commerce-settings': { features: 'commerce', tenantScoped: true },
    'healthcare-settings': { features: 'healthcare', tenantScoped: true },
  })
})
