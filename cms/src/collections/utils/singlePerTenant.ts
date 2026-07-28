import type { CollectionBeforeChangeHook, CollectionSlug } from 'payload'

// Tenant-scoped vertical-settings collections (commerce-settings, healthcare-settings) must hold at
// most one document per tenant. The DB enforces this with a UNIQUE(tenant_id) index; this hook gives
// a readable 400 in the common case and covers the create/create race until the DB index decides it.
// The DB index is the source of truth — keep it in the migration alongside any collection added here.

type SettingsCollectionSlug = 'commerce-settings' | 'healthcare-settings'

export const singlePerTenant = (slug: SettingsCollectionSlug): CollectionBeforeChangeHook =>
  async ({ data, operation, req }) => {
    if (operation !== 'create') return data
    const tenant = (data as { tenant?: number | string | { id?: number | string } }).tenant
    const tenantId = tenant && typeof tenant === 'object' ? tenant.id : tenant
    if (tenantId === undefined || tenantId === null) return data

    const { totalDocs } = await req.payload.count({
      // The generated CollectionSlug union does not include a brand-new collection until
      // generate:types runs. Keep the factory's closed union above and cast only at this API seam.
      collection: slug as CollectionSlug,
      where: { tenant: { equals: tenantId } },
      overrideAccess: true,
      req,
    })
    if (totalDocs > 0) {
      const { APIError } = await import('payload')
      throw new APIError(`This tenant already has a ${slug} document.`, 400, null, true)
    }
    return data
  }
