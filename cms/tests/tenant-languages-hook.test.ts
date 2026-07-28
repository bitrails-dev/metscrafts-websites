import assert from 'node:assert/strict'
import test from 'node:test'
import { validateTenantLanguages } from '../src/collections/Tenants'
import {
  DEFAULT_PLATFORM_LOCALE,
  FALLBACK_PLATFORM_LANGUAGES,
  PLATFORM_LOCALE_CODES,
} from '../src/collections/tenantLocales'
import type { PlatformLocale } from '../src/collections/tenantLocales'

// Unit tests for the `validateTenantLanguages` beforeChange hook (plan §1.4 / §9 — T2 + T3).
// The hook is a pure function `({ data, operation, originalDoc }) => data` that throws APIError(400)
// on invalid input. We call it directly with synthetic args — no DB, fast and deterministic.
//
// Hard constraint honored: every locale VALUE in test data is pulled from the exported catalogue
// arrays (`PLATFORM_LOCALE_CODES`, `DEFAULT_PLATFORM_LOCALE`, `FALLBACK_PLATFORM_LANGUAGES`) or
// derived from them. No catalogue code is redeclared as a literal.

type HookArgs = Parameters<typeof validateTenantLanguages>[0]

const runHook = (args: {
  data: Record<string, unknown>
  originalDoc?: Record<string, unknown>
  operation?: 'create' | 'update'
}) =>
  validateTenantLanguages({
    data: args.data,
    originalDoc: args.originalDoc ?? {},
    operation: args.operation ?? 'create',
  } as HookArgs)

const expect400 = (fn: () => unknown, messagePattern?: RegExp): void => {
  try {
    fn()
    assert.fail('expected the languages hook to reject with 400')
  } catch (err) {
    const error = err as { status?: number; message?: string }
    assert.equal(
      error.status,
      400,
      `expected HTTP 400, got ${error.status}: ${error.message}`,
    )
    if (messagePattern) assert.match(error.message ?? '', messagePattern)
  }
}

// Catalogue-derived non-default subset: every catalogue code that is not the platform default.
const NON_DEFAULT_CODES = PLATFORM_LOCALE_CODES.filter(
  (code) => code !== DEFAULT_PLATFORM_LOCALE,
) as PlatformLocale[]

// An invalid code: the uppercased platform default. The catalogue invariant (asserted in
// tenantLocales.ts) guarantees every code is lowercase two-letter, so this is never in it. Derived
// from the catalogue constant — no literal catalogue code redeclared.
const INVALID_CODE = DEFAULT_PLATFORM_LOCALE.toUpperCase()

// ---------------------------------------------------------------------------
// T2 — create derives a default; invalid/duplicate/empty input → 400
// ---------------------------------------------------------------------------

test('T2: create with no languages and no default derives the platform default', () => {
  // No `languages` and no stored `languages` → effective = FALLBACK_PLATFORM_LANGUAGES, which
  // includes DEFAULT_PLATFORM_LOCALE, so the derived default is DEFAULT_PLATFORM_LOCALE.
  const data: Record<string, unknown> = {}
  runHook({ data, operation: 'create' })
  assert.equal(data.defaultLanguage, DEFAULT_PLATFORM_LOCALE)
})

test('T2: create with a catalogue-derived set including the platform default derives the platform default', () => {
  const data: Record<string, unknown> = { languages: [...PLATFORM_LOCALE_CODES] }
  runHook({ data, operation: 'create' })
  assert.equal(data.defaultLanguage, DEFAULT_PLATFORM_LOCALE)
})

test('T2: create with an invalid locale code is rejected with 400', () => {
  expect400(
    () => runHook({ data: { languages: [INVALID_CODE] }, operation: 'create' }),
    /Unknown locale code/,
  )
})

test('T2: create with a duplicate locale code is rejected with 400', () => {
  const duplicate = [DEFAULT_PLATFORM_LOCALE, DEFAULT_PLATFORM_LOCALE]
  expect400(
    () => runHook({ data: { languages: duplicate }, operation: 'create' }),
    /Duplicate locale code/,
  )
})

test('T2: create with an empty languages array is rejected with 400', () => {
  expect400(
    () => runHook({ data: { languages: [] }, operation: 'create' }),
    /cannot be empty/,
  )
})

test('T2: create with a non-array languages value is rejected with 400', () => {
  expect400(
    () => runHook({ data: { languages: DEFAULT_PLATFORM_LOCALE }, operation: 'create' }),
    /must be an array/,
  )
})

// ---------------------------------------------------------------------------
// T3 — partial updates preserve stored languages/default; inconsistencies → 400
// ---------------------------------------------------------------------------

test('T3: a partial update of contact.phone leaves languages and defaultLanguage byte-identical to the stored doc', () => {
  const storedLanguages = [...(FALLBACK_PLATFORM_LANGUAGES as PlatformLocale[])]
  const storedDefault = DEFAULT_PLATFORM_LOCALE
  const data: Record<string, unknown> = {
    contact: { phone: '+200' },
  }
  const result = runHook({
    data,
    operation: 'update',
    originalDoc: { languages: storedLanguages, defaultLanguage: storedDefault },
  }) as Record<string, unknown>
  // The hook must not synthesize or mutate either field on an unrelated partial update — the
  // stored values remain on disk byte-identical because they are never written.
  assert.equal('languages' in result, false, 'languages must not be injected into the write')
  assert.equal(
    'defaultLanguage' in result,
    false,
    'defaultLanguage must not be injected into the write',
  )
  // And the in-memory stored values are untouched.
  assert.deepEqual(storedLanguages, FALLBACK_PLATFORM_LANGUAGES as PlatformLocale[])
  assert.equal(storedDefault, DEFAULT_PLATFORM_LOCALE)
})

test('T3: an explicit INVALID default on update is rejected with 400', () => {
  // Stored effective set is a single-element slice containing only the platform default; the
  // first non-default catalogue code is outside that set.
  const storedLanguages = PLATFORM_LOCALE_CODES.slice(0, 1) as PlatformLocale[]
  const notInSet = NON_DEFAULT_CODES[0]
  expect400(
    () =>
      runHook({
        data: { defaultLanguage: notInSet },
        operation: 'update',
        originalDoc: { languages: [...storedLanguages], defaultLanguage: storedLanguages[0] },
      }),
    /defaultLanguage must be one of/,
  )
})

test('T3: a languages-only update that removes the stored default from the set is rejected with 400', () => {
  // Stored: [DEFAULT, second]. Incoming: [second] — drops the stored default silently.
  const storedLanguages: PlatformLocale[] = [DEFAULT_PLATFORM_LOCALE, NON_DEFAULT_CODES[0]]
  expect400(
    () =>
      runHook({
        data: { languages: [NON_DEFAULT_CODES[0]] },
        operation: 'update',
        originalDoc: { languages: storedLanguages, defaultLanguage: DEFAULT_PLATFORM_LOCALE },
      }),
    /defaultLanguage must be one of/,
  )
})

test('T3: the same languages-only update WITH a valid replacement default succeeds', () => {
  const storedLanguages: PlatformLocale[] = [DEFAULT_PLATFORM_LOCALE, NON_DEFAULT_CODES[0]]
  const data: Record<string, unknown> = {
    languages: [NON_DEFAULT_CODES[0]],
    defaultLanguage: NON_DEFAULT_CODES[0],
  }
  assert.doesNotThrow(() =>
    runHook({
      data,
      operation: 'update',
      originalDoc: { languages: storedLanguages, defaultLanguage: DEFAULT_PLATFORM_LOCALE },
    }),
  )
  // The replaced default is now the only element of the effective set.
  assert.equal(data.defaultLanguage, NON_DEFAULT_CODES[0])
})

test('T3: create with no default and a catalogue-derived non-default subset derives the subset first entry as default', () => {
  const subset = [...NON_DEFAULT_CODES]
  const data: Record<string, unknown> = { languages: subset }
  runHook({ data, operation: 'create' })
  assert.equal(data.defaultLanguage, subset[0])
})
