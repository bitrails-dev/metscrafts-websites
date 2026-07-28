import type { CollectionConfig } from 'payload'
import { singlePerTenant } from '../utils/singlePerTenant'

// Tenant-scoped healthcare-vertical settings: the public-website hero statistics and the emergency
// number. Exactly one document per tenant (the singlePerTenant hook + a UNIQUE(tenant_id) index from
// the migration). `hospital` and `clinic` tenant types both carry the same hero shape, so they share
// this single healthcare settings collection.
//
// Hero stats and the emergency number are PUBLIC website content: the anonymous public site reads
// them over REST without authentication, so `read` is open. Create/update/delete stay authenticated
// and are gated on the `healthcare` feature by tenantFeatureAccessPlugin.
//
// The `tenant` relationship is injected by multiTenantPlugin (do not declare it here).

// Mirrors the Tenants hero `stat` factory. Kept here until Phase 5 removes the legacy hero group from
// Tenants; this collection then becomes the sole owner.
const stat = (name: string, ar: string, en: string) => ({
  name,
  type: 'group' as const,
  label: { ar, en },
  fields: [
    { name: 'value', type: 'text' as const, localized: true, required: true,
      label: { ar: 'القيمة', en: 'Value' } },
    { name: 'unit', type: 'text' as const, localized: true,
      label: { ar: 'الوحدة', en: 'Unit' } },
  ],
})

export const HealthcareSettings: CollectionConfig = {
  slug: 'healthcare-settings',
  labels: {
    singular: { ar: 'إعدادات الرعاية الصحية', en: 'Healthcare settings' },
    plural: { ar: 'إعدادات الرعاية الصحية', en: 'Healthcare settings' },
  },
  admin: {
    group: { ar: 'الرعاية الصحية', en: 'Healthcare' },
    useAsTitle: 'tenant',
  },
  access: {
    read: () => true,
  },
  hooks: { beforeChange: [singlePerTenant('healthcare-settings')] },
  fields: [
    {
      name: 'hero',
      type: 'group',
      label: { ar: 'إحصائيات الواجهة', en: 'Hero stats' },
      fields: [
        stat('years', 'سنوات', 'Years'),
        stat('departments', 'الأقسام', 'Departments'),
        stat('patients', 'المرضى', 'Patients'),
        stat('staff', 'الطاقم', 'Staff'),
      ],
    },
    { name: 'emergencyNumber', type: 'text', label: { ar: 'رقم الطوارئ', en: 'Emergency number' } },
  ],
}
