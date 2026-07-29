// Frontend cutover tests for healthcare-settings. Covers the shared normalizer (locale=all →
// view model, 0/1/>1 docs), the applyTenant emergency overlay (+ i18n fallback), and the REST
// backend end-to-end (tenant-scoped limit=1 fetch + normalization). The in-process backend shares
// the same normalizer over its findDocs seam, so its output is identical by construction.
//
// Run: pnpm --filter @bitrails-works/astro test:healthcare-settings
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeHealthcareSettings,
  normalizeHealthcareSettingsDocs,
} from '../src/cms/shared/healthcare-settings'
import { applyTenant, type Tenant } from '../src/lib/tenant'

// A raw healthcare-settings doc as the CMS returns it under locale=all (each localized field is
// { en, ar }; emergencyNumber is a plain string on the parent).
const rawDoc = {
  id: 1,
  tenant: 7,
  emergencyNumber: '12345',
  // `value` is a single non-localized number; `unit` is localized {en, ar}.
  hero: {
    years:       { value: 67,   unit: { en: '+',  ar: '+'  } },
    departments: { value: 28,   unit: { en: '',   ar: ''   } },
    patients:    { value: 1.2,  unit: { en: 'M+', ar: 'م+' } },
    staff:       { value: 2400, unit: { en: '+',  ar: '+'  } },
  },
}

// --- shared normalizer: locale=all preservation ---

test('normalizeHealthcareSettings maps value→number + localized unit + the emergency number', () => {
  const vm = normalizeHealthcareSettings(rawDoc)
  assert.equal(vm.emergencyNumber, '12345')
  assert.equal(vm.stats.years.value, 67)            // non-localized number
  assert.equal(vm.stats.years.unit, '+')            // en unit
  assert.equal(vm.stats.years.unitAr, '+')          // ar unit
  assert.equal(vm.stats.patients.value, 1.2)        // decimal preserved
  assert.equal(vm.stats.patients.unitAr, 'م+')
  assert.equal(vm.stats.staff.value, 2400)
  assert.deepEqual(Object.keys(vm.stats).sort(), ['departments', 'patients', 'staff', 'years'])
})

test('normalizeHealthcareSettings coerces a missing/invalid value to 0', () => {
  const vm = normalizeHealthcareSettings({ emergencyNumber: '911', hero: { years: {} } })
  assert.equal(vm.stats.years.value, 0)
  assert.equal(vm.stats.years.unit, '')
})

test('Intl.NumberFormat renders the number per locale (the approach the components use)', () => {
  assert.equal(new Intl.NumberFormat('en').format(2400), '2,400')
  assert.equal(new Intl.NumberFormat('ar-EG').format(2400), '٢٬٤٠٠')
  assert.equal(new Intl.NumberFormat('ar-EG').format(1.2), '١٫٢')
  assert.equal(new Intl.NumberFormat('ar-EG').format(67), '٦٧')
})

// --- shared normalizer: 0 / 1 / >1 docs ---

test('normalizeHealthcareSettingsDocs returns undefined for empty/null input', () => {
  assert.equal(normalizeHealthcareSettingsDocs(undefined), undefined)
  assert.equal(normalizeHealthcareSettingsDocs(null), undefined)
  assert.equal(normalizeHealthcareSettingsDocs([]), undefined)
})

test('normalizeHealthcareSettingsDocs normalizes a single doc', () => {
  const vm = normalizeHealthcareSettingsDocs([rawDoc])
  assert.equal(vm?.emergencyNumber, '12345')
  assert.equal(vm?.stats.departments.value, 28)
})

test('normalizeHealthcareSettingsDocs throws when more than one doc is returned (uniqueness violation)', () => {
  assert.throws(
    () => normalizeHealthcareSettingsDocs([rawDoc, rawDoc]),
    /at most one document per tenant/,
  )
})

// --- applyTenant emergency overlay (healthcare) + i18n fallback ---

const baseStrings = { site: {}, contact: { details: { emergencyNumber: '000', phone: 'base-phone' } } }
const tenant = {
  id: 7, slug: 'hosp', type: 'hospital', name: 'H', nameAr: 'ه', domains: [],
  features: ['healthcare'], contact: {},
} as Tenant

test('applyTenant overlays the healthcare emergency number when settings are present', () => {
  const out = applyTenant(baseStrings, tenant, 'en', { emergencyNumber: '12345', stats: {} as any })
  assert.equal(out.contact.details.emergencyNumber, '12345')
  // The healthcare source wins over the i18n fallback.
  assert.notEqual(out.contact.details.emergencyNumber, '000')
})

test('applyTenant keeps the i18n emergency fallback when healthcare settings are missing', () => {
  assert.equal(applyTenant(baseStrings, tenant, 'en').contact.details.emergencyNumber, '000')
  assert.equal(
    applyTenant(baseStrings, tenant, 'en', { stats: {} as any }).contact.details.emergencyNumber,
    '000',
  )
})

test('applyTenant returns strings untouched when no tenant is resolved', () => {
  assert.equal(applyTenant(baseStrings, undefined, 'en'), baseStrings)
})

// --- REST backend end-to-end (mocked fetch) ---

test('REST backend getHealthcareSettings fetches the tenant-scoped doc (limit 1) and normalizes it', async () => {
  const originalFetch = globalThis.fetch
  let calledUrl: string | undefined
  globalThis.fetch = (async (input: any) => {
    calledUrl = typeof input === 'string' ? input : input.url
    return { ok: true, status: 200, json: async () => ({ docs: [rawDoc] }), text: async () => '' } as any
  }) as any
  try {
    const { apiBackend } = await import('../src/cms/api')
    const vm = await apiBackend.getHealthcareSettings(7)
    assert.ok(calledUrl, 'fetch must be called')
    assert.match(calledUrl!, /\/api\/healthcare-settings\?/)
    assert.match(calledUrl!, /limit=1/)
    assert.match(calledUrl!, /where\[tenant\]\[equals\]=7/)
    assert.equal(vm?.emergencyNumber, '12345')
    assert.equal(vm?.stats.staff.value, 2400)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('REST backend getHealthcareSettings returns undefined when the CMS has no settings doc', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => ({ docs: [] }), text: async () => '' }) as any) as any
  try {
    const { apiBackend } = await import('../src/cms/api')
    assert.equal(await apiBackend.getHealthcareSettings(7), undefined)
  } finally {
    globalThis.fetch = originalFetch
  }
})
