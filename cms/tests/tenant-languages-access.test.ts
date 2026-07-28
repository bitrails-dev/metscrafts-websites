import assert from 'node:assert/strict'
import test from 'node:test'
import { enforceTenantSettingsEntitlement } from '../src/access/tenantSettings'
import {
  DEFAULT_PLATFORM_LOCALE,
  FALLBACK_PLATFORM_LANGUAGES,
  PLATFORM_LOCALE_CODES,
} from '../src/collections/tenantLocales'
import type { PlatformLocale } from '../src/collections/tenantLocales'

// Unit tests for the T4 access boundary: a non-super-admin tenant admin must not be able to write
// the platform-managed `languages` or `defaultLanguage` fields. Enforcement lives in
// `enforceTenantSettingsEntitlement` (cms/src/access/tenantSettings.ts), which lists both fields in
// `TENANT_PLATFORM_FIELDS` and throws APIError(403) when an incoming value differs from stored.
//
// We exercise the hook directly with synthetic users — the same pattern as tenant-settings.test.ts.
//
// Hard constraint honored: every locale value in test data is pulled from the exported catalogue
// arrays or derived from them. No catalogue code is redeclared as a literal.

type HookArgs = Parameters<typeof enforceTenantSettingsEntitlement>[0]

const superAdmin = { id: 1, roles: ['super-admin'], tenants: [] }
const tenantAdmin = (id: number | string = 7) => ({
  id: 2,
  roles: ['admin'],
  tenants: [{ tenant: id }],
})

const runHook = (args: {
  user: unknown
  data: Record<string, unknown>
  originalDoc: Record<string, unknown>
  operation?: 'create' | 'update'
}) =>
  enforceTenantSettingsEntitlement({
    data: args.data,
    originalDoc: args.originalDoc,
    operation: args.operation ?? 'update',
    req: { user: args.user },
  } as HookArgs)

const expect403 = (fn: () => unknown, messagePattern?: RegExp): void => {
  try {
    fn()
    assert.fail('expected the entitlement hook to reject with 403')
  } catch (err) {
    const error = err as { status?: number; message?: string }
    assert.equal(
      error.status,
      403,
      `expected HTTP 403, got ${error.status}: ${error.message}`,
    )
    if (messagePattern) assert.match(error.message ?? '', messagePattern)
  }
}

// The first non-default catalogue code, used as an alternative value that differs from the stored
// platform default. Derived from the catalogue exports — no literal.
const NON_DEFAULT_FIRST = (PLATFORM_LOCALE_CODES.filter(
  (code) => code !== DEFAULT_PLATFORM_LOCALE,
) as PlatformLocale[])[0]

const tenantWithLanguages = (): Record<string, unknown> => ({
  id: 7,
  name: 'Al Salam Hospital',
  slug: 'al-salam',
  type: 1,
  domains: ['al-salam.test'],
  features: ['departments'],
  settingsEntitlement: ['general', 'branding', 'contact', 'socialPublishing'],
  languages: [...(FALLBACK_PLATFORM_LANGUAGES as PlatformLocale[])],
  defaultLanguage: DEFAULT_PLATFORM_LOCALE,
})

test('T4: a tenant admin cannot write the "languages" field (403)', () => {
  const original = tenantWithLanguages()
  // A catalogue-derived set that differs from the stored fallback set (the full code list).
  const forgedLanguages = [...PLATFORM_LOCALE_CODES]
  expect403(
    () =>
      runHook({
        user: tenantAdmin(),
        originalDoc: original,
        data: { languages: forgedLanguages },
      }),
    /Only platform super-admins can change the "languages"/,
  )
})

test('T4: a tenant admin cannot write the "defaultLanguage" field (403)', () => {
  const original = tenantWithLanguages()
  expect403(
    () =>
      runHook({
        user: tenantAdmin(),
        originalDoc: original,
        data: { defaultLanguage: NON_DEFAULT_FIRST },
      }),
    /Only platform super-admins can change the "defaultLanguage"/,
  )
})

test('T4: a tenant admin cannot write both fields together (403)', () => {
  const original = tenantWithLanguages()
  expect403(
    () =>
      runHook({
        user: tenantAdmin(),
        originalDoc: original,
        data: {
          languages: [...PLATFORM_LOCALE_CODES],
          defaultLanguage: NON_DEFAULT_FIRST,
        },
      }),
    /Only platform super-admins can change the "languages"/,
  )
})

test('T4: a super-admin can change both fields (sanity — the platform owns these)', () => {
  const original = tenantWithLanguages()
  assert.doesNotThrow(() =>
    runHook({
      user: superAdmin,
      originalDoc: original,
      data: {
        languages: [...PLATFORM_LOCALE_CODES],
        defaultLanguage: NON_DEFAULT_FIRST,
      },
    }),
  )
})

test('T4: re-submitting the stored language/default values unchanged is a no-op for a tenant admin', () => {
  const original = tenantWithLanguages()
  // Deep-equal values are treated as no-ops so partial updates never erase untouched settings.
  assert.doesNotThrow(() =>
    runHook({
      user: tenantAdmin(),
      originalDoc: original,
      data: {
        languages: original.languages,
        defaultLanguage: original.defaultLanguage,
      },
    }),
  )
})
