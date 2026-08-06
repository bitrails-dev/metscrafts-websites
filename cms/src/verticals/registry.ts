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

// slug → tenant-global map for multiTenantPlugin's `collections` option. `isGlobal` is Payload's
// multi-tenant singleton mode: opening the collection resolves the selected tenant's one document
// and redirects straight to edit (or the create form when it does not exist). This is the right
// UX for settings, which are never a list of records from a tenant user's perspective.
export const verticalSettingsCollections = Object.fromEntries(
  VERTICAL_SETTINGS.map(({ config }) => [config.slug, { isGlobal: true }]),
)

// slug → { features, tenantScoped } policy entries merged into tenantFeatureAccessPlugin's feature map.
export const verticalSettingsFeatureMap = Object.fromEntries(
  VERTICAL_SETTINGS.map(({ config, feature }) => [
    config.slug,
    { features: feature, tenantScoped: true as const },
  ]),
)
