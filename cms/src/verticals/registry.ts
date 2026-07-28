import type { CollectionConfig } from 'payload'
import type { TenantFeature } from '../collections/tenantFeatures'
import { CommerceSettings } from '../collections/commerce/CommerceSettings'
import { HealthcareSettings } from '../collections/healthcare/HealthcareSettings'

// The single registry of tenant-scoped vertical-settings collections. Each entry pairs a Payload
// collection config with the TenantFeature that gates it. The CMS wiring (payload.config.ts,
// multiTenantPlugin, tenantFeatureAccessPlugin) is derived from this list so a new vertical-settings
// collection needs no duplicated wiring edits — but it still requires a feature declaration, a
// registry entry here, a migration, tests, and frontend integration. This removes only the three
// repeated CMS wiring edits, it is not a literal one-folder change.

export type VerticalSettingsEntry = Readonly<{
  config: CollectionConfig
  feature: TenantFeature
}>

export const VERTICAL_SETTINGS = [
  { config: CommerceSettings, feature: 'commerce' },
  { config: HealthcareSettings, feature: 'healthcare' },
] as const satisfies readonly VerticalSettingsEntry[]

// slug → {} map for multiTenantPlugin's `collections` option (which keys tenant-owned collections by slug).
export const verticalSettingsCollections = Object.fromEntries(
  VERTICAL_SETTINGS.map(({ config }) => [config.slug, {}]),
)

// slug → { features, tenantScoped } policy entries merged into tenantFeatureAccessPlugin's feature map.
export const verticalSettingsFeatureMap = Object.fromEntries(
  VERTICAL_SETTINGS.map(({ config, feature }) => [
    config.slug,
    { features: feature, tenantScoped: true as const },
  ]),
)
