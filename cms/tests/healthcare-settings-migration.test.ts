// Data-safe round-trip for Migration A (add_and_backfill_healthcare_settings). Runs entirely on a
// throwaway scratch SQLite file: applies every PRIOR migration, seeds legacy healthcare tenants with
// localized hero data and an existing unrelated feature, then exercises A.up -> A.down -> A.up and
// asserts:
//   - one healthcare_settings row per hospital/clinic tenant; none for a non-healthcare tenant;
//   - localized hero values copied byte-for-byte; the emergency number copied;
//   - the existing feature is preserved and `healthcare` granted exactly once to hospital/clinic only
//     (both on tenants and their tenant-types default template);
//   - UNIQUE(tenant_id) prevents a second settings row;
//   - down removes the new schema + the `healthcare` feature and leaves legacy tenant data unchanged;
//   - up -> down -> up is idempotent on scratch SQLite.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from '@payloadcms/db-sqlite'

const TEMP_DB = join(tmpdir(), `healthcare-settings-migrtest-${process.pid}-${Date.now()}.db`)
process.env.DATABASE_URI = `file:${TEMP_DB}`
process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'healthcare-settings-migration-test-secret'

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')
const { migrations } = await import('../src/migrations')

const MIGRATION_NAME = '20260727_130000_add_and_backfill_healthcare_settings'
const MIGRATION_INDEX = migrations.findIndex((m) => m.name === MIGRATION_NAME)
const PRIOR = migrations.slice(0, MIGRATION_INDEX)
const TARGET = migrations[MIGRATION_INDEX]
const TARGET_B = migrations.find((m) => m.name === '20260727_130100_drop_healthcare_fields_from_tenants')
const TARGET_C = migrations.find((m) => m.name === '20260729_140000_hero_value_to_number')

type DB = { run: (q: unknown) => Promise<{ rows: unknown[] }> }

let payload: Awaited<ReturnType<typeof getPayload>> | undefined
let db: DB | undefined

const drizzle = (): DB => {
  if (!db) throw new Error('db not initialized')
  return db
}

// Run a batch of migrations up/down in order, passing the drizzle instance as `db`.
const runMigrations = async (list: typeof migrations, dir: 'up' | 'down') => {
  for (const m of list) {
    await m[dir]({ db: drizzle(), payload: payload, req: undefined } as never)
  }
}

const rows = async (query: ReturnType<typeof sql>) => {
  const res = await drizzle().run(query)
  return res.rows as Record<string, unknown>[]
}
const scalar = async <T = unknown>(query: ReturnType<typeof sql>): Promise<T | undefined> => {
  const r = await rows(query)
  return (r[0] as Record<string, unknown> | undefined)?.v as T | undefined
}

const call = (q: ReturnType<typeof sql>) => drizzle().run(q)

// Distinctive seeded hero values per locale (so a byte-mismatch is unambiguous).
const HOSP_AR = { years: '67', yearsUnit: '+', departments: '28', departmentsUnit: '', patients: '1.2', patientsUnit: 'M+', staff: '2400', staffUnit: '+' }
const HOSP_EN = { years: '67', yearsUnit: '+', departments: '28', departmentsUnit: '', patients: '1.2', patientsUnit: 'M+', staff: '2,400', staffUnit: '+' }
const CLINIC_AR = { years: '20', yearsUnit: '', departments: '5', departmentsUnit: '', patients: '500', patientsUnit: '', staff: '40', staffUnit: '' }

const insertLocale = async (
  name: string,
  locale: string,
  parentId: number | string,
  s: typeof HOSP_AR,
) => {
  await call(sql`INSERT INTO \`tenants_locales\` (
  		\`name\`, \`hero_years_value\`, \`hero_years_unit\`, \`hero_departments_value\`, \`hero_departments_unit\`,
  		\`hero_patients_value\`, \`hero_patients_unit\`, \`hero_staff_value\`, \`hero_staff_unit\`,
  		\`_locale\`, \`_parent_id\`
  	) VALUES (
  		${name}, ${s.years}, ${s.yearsUnit}, ${s.departments}, ${s.departmentsUnit},
  		${s.patients}, ${s.patientsUnit}, ${s.staff}, ${s.staffUnit},
  		${locale}, ${parentId}
  	);`)
}

let ids: { hosp: number; clinic: number; pharm: number; hospType: number; clinicType: number; pharmType: number }

test.before(async () => {
  payload = await getPayload({ config })
  db = (payload as unknown as { db: { drizzle: DB } }).db.drizzle
  // Apply every migration up to (but not including) A: the legacy hero/emergency columns are present.
  await runMigrations(PRIOR, 'up')

  // --- Seed: hospital (ar+en), clinic (ar only), pharmacy (non-healthcare). Every tenant carries an
  //     existing unrelated feature so the grant is proven to append, not replace. ---
  await call(sql`INSERT INTO \`tenant_types\` (\`slug\`) VALUES ('hospital'), ('clinic'), ('pharmacy');`)
  const hospType = await scalar<number>(sql`SELECT id AS v FROM \`tenant_types\` WHERE slug='hospital';`)
  const clinicType = await scalar<number>(sql`SELECT id AS v FROM \`tenant_types\` WHERE slug='clinic';`)
  const pharmType = await scalar<number>(sql`SELECT id AS v FROM \`tenant_types\` WHERE slug='pharmacy';`)
  if (hospType === undefined || clinicType === undefined || pharmType === undefined) throw new Error('tenant_types seed failed')

  for (const [tid, ar, en] of [
    [hospType, 'مستشفى', 'Hospital'],
    [clinicType, 'عيادة', 'Clinic'],
    [pharmType, 'صيدلية', 'Pharmacy'],
  ] as const) {
    await call(sql`INSERT INTO \`tenant_types_locales\` (\`name\`, \`_locale\`, \`_parent_id\`) VALUES (${ar}, 'ar', ${tid});`)
    await call(sql`INSERT INTO \`tenant_types_locales\` (\`name\`, \`_locale\`, \`_parent_id\`) VALUES (${en}, 'en', ${tid});`)
    await call(sql`INSERT INTO \`tenant_types_default_features\` (\`order\`, \`parent_id\`, \`value\`) VALUES (0, ${tid}, 'departments');`)
  }

  await call(sql`INSERT INTO \`tenants\` (\`slug\`, \`type_id\`, \`contact_emergency_number\`) VALUES ('hosp', ${hospType}, '123');`)
  await call(sql`INSERT INTO \`tenants\` (\`slug\`, \`type_id\`, \`contact_emergency_number\`) VALUES ('clinic', ${clinicType}, '456');`)
  await call(sql`INSERT INTO \`tenants\` (\`slug\`, \`type_id\`) VALUES ('pharm', ${pharmType});`)
  const hosp = await scalar<number>(sql`SELECT id AS v FROM \`tenants\` WHERE slug='hosp';`)
  const clinic = await scalar<number>(sql`SELECT id AS v FROM \`tenants\` WHERE slug='clinic';`)
  const pharm = await scalar<number>(sql`SELECT id AS v FROM \`tenants\` WHERE slug='pharm';`)
  if (hosp === undefined || clinic === undefined || pharm === undefined) throw new Error('tenants seed failed')

  await insertLocale('مستشفى دمياط', 'ar', hosp, HOSP_AR)
  await insertLocale('Damietta Hospital', 'en', hosp, HOSP_EN)
  await insertLocale('عيادة دمياط', 'ar', clinic, CLINIC_AR)
  // Pharmacy gets a locale row (name is required) with zeroed hero values; its type excludes it.
  await insertLocale('صيدلية', 'ar', pharm, { years: '0', yearsUnit: '', departments: '0', departmentsUnit: '', patients: '0', patientsUnit: '', staff: '0', staffUnit: '' })

  for (const tid of [hosp, clinic, pharm]) {
    await call(sql`INSERT INTO \`tenants_features\` (\`order\`, \`parent_id\`, \`value\`) VALUES (0, ${tid}, 'departments');`)
  }

  ids = { hosp, clinic, pharm, hospType, clinicType, pharmType }
})

test.after(async () => {
  try { await payload?.destroy() } catch { /* disposable */ }
  try { rmSync(TEMP_DB, { force: true }) } catch { /* ignore */ }
})

test('migration A is registered after store_products_localization; B then C follow, C last', () => {
  assert.ok(MIGRATION_INDEX > 0)
  assert.equal(migrations[MIGRATION_INDEX - 1].name, '20260722_100300_store_products_localization')
  assert.ok(TARGET_B, 'migration B must be registered')
  assert.ok(TARGET_C, 'migration C must be registered')
  assert.equal(migrations[MIGRATION_INDEX + 1]?.name, '20260727_130100_drop_healthcare_fields_from_tenants')
  assert.equal(migrations[migrations.length - 1].name, '20260729_140000_hero_value_to_number')
})

// Read the ordered feature values for a tenant (by slug) or a tenant-type (by slug + flag).
const tenantFeatures = (slug: string) =>
  rows(sql`SELECT tf.value AS v FROM \`tenants_features\` tf JOIN \`tenants\` t ON t.id = tf.parent_id WHERE t.slug = ${slug} ORDER BY tf.\`order\`;`).then((r) => r.map((x) => String(x.v)))
const typeFeatures = (slug: string) =>
  rows(sql`SELECT tdf.value AS v FROM \`tenant_types_default_features\` tdf JOIN \`tenant_types\` tt ON tt.id = tdf.parent_id WHERE tt.slug = ${slug} ORDER BY tdf.\`order\`;`).then((r) => r.map((x) => String(x.v)))

test('A.up backfills one healthcare_settings per hospital/clinic tenant with byte-identical hero + emergency', async () => {
  await TARGET.up({ db: drizzle(), payload: payload, req: undefined } as never)

  // Exactly two parent rows (hospital + clinic); pharmacy excluded.
  assert.equal(await scalar<number>(sql`SELECT COUNT(*) AS v FROM \`healthcare_settings\`;`), 2)
  assert.equal(await scalar<number>(sql`SELECT COUNT(*) AS v FROM \`healthcare_settings\` hs JOIN \`tenants\` t ON t.id = hs.tenant_id WHERE t.slug = 'pharm';`), 0)

  // Three locale rows: hospital ar+en, clinic ar.
  assert.equal(await scalar<number>(sql`SELECT COUNT(*) AS v FROM \`healthcare_settings_locales\`;`), 3)
  assert.equal(await scalar<number>(sql`SELECT COUNT(*) AS v FROM \`healthcare_settings_locales\` hsl JOIN \`healthcare_settings\` hs ON hs.id = hsl._parent_id JOIN \`tenants\` t ON t.id = hs.tenant_id WHERE t.slug = 'hosp';`), 2)
  assert.equal(await scalar<number>(sql`SELECT COUNT(*) AS v FROM \`healthcare_settings_locales\` hsl JOIN \`healthcare_settings\` hs ON hs.id = hsl._parent_id JOIN \`tenants\` t ON t.id = hs.tenant_id WHERE t.slug = 'clinic' AND hsl._locale = 'ar';`), 1)

  // Emergency number copied verbatim from tenants.
  assert.equal(await scalar<string>(sql`SELECT hs.emergency_number AS v FROM \`healthcare_settings\` hs JOIN \`tenants\` t ON t.id = hs.tenant_id WHERE t.slug = 'hosp';`), '123')
  assert.equal(await scalar<string>(sql`SELECT hs.emergency_number AS v FROM \`healthcare_settings\` hs JOIN \`tenants\` t ON t.id = hs.tenant_id WHERE t.slug = 'clinic';`), '456')

  // Byte-for-byte hero copy per locale (NULL-safe compare against the seeded source row).
  const mismatched = await scalar<number>(sql`
  	SELECT COUNT(*) AS v
  	FROM \`tenants_locales\` tl
  	JOIN \`tenants\` t ON t.id = tl._parent_id
  	JOIN \`tenant_types\` tt ON tt.id = t.type_id
  	JOIN \`healthcare_settings\` hs ON hs.tenant_id = t.id
  	JOIN \`healthcare_settings_locales\` hsl ON hsl._parent_id = hs.id AND hsl._locale = tl._locale
  	WHERE tt.slug IN ('hospital', 'clinic')
  		AND (
  			hsl.hero_years_value IS NOT tl.hero_years_value
  			OR hsl.hero_years_unit IS NOT tl.hero_years_unit
  			OR hsl.hero_departments_value IS NOT tl.hero_departments_value
  			OR hsl.hero_departments_unit IS NOT tl.hero_departments_unit
  			OR hsl.hero_patients_value IS NOT tl.hero_patients_value
  			OR hsl.hero_patients_unit IS NOT tl.hero_patients_unit
  			OR hsl.hero_staff_value IS NOT tl.hero_staff_value
  			OR hsl.hero_staff_unit IS NOT tl.hero_staff_unit
  		);`)
  assert.equal(mismatched, 0, 'every eligible hero value/unit must be copied byte-for-byte')

  // Spot-check the distinctive en staff value round-tripped (proves locale selection, not just ar).
  const hospEnStaff = await scalar<string>(sql`SELECT hsl.hero_staff_value AS v FROM \`healthcare_settings_locales\` hsl JOIN \`healthcare_settings\` hs ON hs.id = hsl._parent_id JOIN \`tenants\` t ON t.id = hs.tenant_id WHERE t.slug = 'hosp' AND hsl._locale = 'en';`)
  assert.equal(hospEnStaff, HOSP_EN.staff)

  // The document-lock rel column + indexes exist.
  const lockCols = (await rows(sql`PRAGMA table_info(\`payload_locked_documents_rels\`);`)).map((c) => String(c.name))
  assert.ok(lockCols.includes('healthcare_settings_id'), 'payload_locked_documents_rels.healthcare_settings_id must exist')
  const idx = (await rows(sql`SELECT name AS v FROM sqlite_master WHERE type='index' AND name='healthcare_settings_tenant_unique';`))
  assert.equal(idx.length, 1, 'healthcare_settings_tenant_unique index must exist')
})

test('A.up grants healthcare exactly once to hospital/clinic tenants+types, preserving existing features', async () => {
  assert.deepEqual((await tenantFeatures('hosp')).sort(), ['departments', 'healthcare'])
  assert.deepEqual((await tenantFeatures('clinic')).sort(), ['departments', 'healthcare'])
  assert.deepEqual((await tenantFeatures('pharm')), ['departments'])

  assert.deepEqual((await typeFeatures('hospital')).sort(), ['departments', 'healthcare'])
  assert.deepEqual((await typeFeatures('clinic')).sort(), ['departments', 'healthcare'])
  assert.deepEqual((await typeFeatures('pharmacy')), ['departments'])

  // Exactly once: no double-grant on any eligible tenant/type.
  assert.equal(await scalar<number>(sql`SELECT COUNT(*) AS v FROM \`tenants_features\` WHERE value = 'healthcare';`), 2)
  assert.equal(await scalar<number>(sql`SELECT COUNT(*) AS v FROM \`tenant_types_default_features\` WHERE value = 'healthcare';`), 2)
})

test('UNIQUE(tenant_id) prevents a second healthcare_settings row for the same tenant', async () => {
  // The insert rejects (drizzle wraps the underlying UNIQUE violation as a "Failed query" error).
  await assert.rejects(
    call(sql`INSERT INTO \`healthcare_settings\` (\`tenant_id\`) VALUES (${ids.hosp});`),
    /Failed query|UNIQUE|constraint|healthcare_settings_tenant_unique/i,
  )
})

test('A.down removes the new schema + healthcare feature and leaves legacy tenant data unchanged', async () => {
  // Snapshot legacy data BEFORE down.
  const legacyEmergency = await scalar<string>(sql`SELECT contact_emergency_number AS v FROM \`tenants\` WHERE slug = 'hosp';`)
  const legacyHero = await scalar<string>(sql`SELECT hero_staff_value AS v FROM \`tenants_locales\` tl JOIN \`tenants\` t ON t.id = tl._parent_id WHERE t.slug = 'hosp' AND tl._locale = 'en';`)
  const legacyFeatures = await tenantFeatures('hosp')

  await TARGET.down({ db: drizzle(), payload: payload, req: undefined } as never)

  // New schema gone.
  const tables = (await rows(sql`SELECT name AS v FROM sqlite_master WHERE type='table' AND name IN ('healthcare_settings', 'healthcare_settings_locales');`)).map((r) => String(r.v))
  assert.deepEqual(tables, [], 'down must drop both healthcare_settings tables')
  const lockCols = (await rows(sql`PRAGMA table_info(\`payload_locked_documents_rels\`);`)).map((c) => String(c.name))
  assert.equal(lockCols.includes('healthcare_settings_id'), false, 'down must drop the lock-rel column')

  // healthcare feature removed everywhere; existing features intact.
  assert.equal(await scalar<number>(sql`SELECT COUNT(*) AS v FROM \`tenants_features\` WHERE value = 'healthcare';`), 0)
  assert.equal(await scalar<number>(sql`SELECT COUNT(*) AS v FROM \`tenant_types_default_features\` WHERE value = 'healthcare';`), 0)
  assert.deepEqual(await tenantFeatures('hosp'), legacyFeatures.filter((f) => f !== 'healthcare'))

  // Legacy hero + emergency byte-identical (the source columns were never touched by A).
  assert.equal(await scalar<string>(sql`SELECT contact_emergency_number AS v FROM \`tenants\` WHERE slug = 'hosp';`), legacyEmergency)
  assert.equal(await scalar<string>(sql`SELECT hero_staff_value AS v FROM \`tenants_locales\` tl JOIN \`tenants\` t ON t.id = tl._parent_id WHERE t.slug = 'hosp' AND tl._locale = 'en';`), legacyHero)
})

test('A.up -> A.down -> A.up is idempotent on scratch SQLite', async () => {
  // DB is currently in the post-down state (legacy only). Re-run up and confirm the same coverage.
  await TARGET.up({ db: drizzle(), payload: payload, req: undefined } as never)
  assert.equal(await scalar<number>(sql`SELECT COUNT(*) AS v FROM \`healthcare_settings\`;`), 2)
  assert.equal(await scalar<number>(sql`SELECT COUNT(*) AS v FROM \`healthcare_settings_locales\`;`), 3)
  assert.deepEqual((await tenantFeatures('hosp')).sort(), ['departments', 'healthcare'])
  assert.deepEqual((await typeFeatures('pharmacy')), ['departments'])
  // The pre-check guard means a bare second up() (without down) would abort — the migration ledger
  // is what prevents that in production; here the down->up cycle proves the SQL itself is repeatable.
})

test('A.up -> B.up -> B.down -> A.down preserves healthcare tenant hero+emergency and all other data', async () => {
  if (!TARGET_B) throw new Error('migration B not found')
  // Earlier tests leave the DB in the post-A.up state (healthcare_settings populated).
  assert.equal(await scalar<number>(sql`SELECT COUNT(*) AS v FROM \`healthcare_settings\`;`), 2)

  // Snapshot healthcare tenant hero (per locale) + emergency, plus a non-hero column for all tenants.
  const snap = (slug: string, locale: string) =>
    rows(sql`SELECT tl.\`hero_years_value\` AS yv, tl.\`hero_years_unit\` AS yu, tl.\`hero_departments_value\` AS dv, tl.\`hero_departments_unit\` AS du,
  			tl.\`hero_patients_value\` AS pv, tl.\`hero_patients_unit\` AS pu, tl.\`hero_staff_value\` AS sv, tl.\`hero_staff_unit\` AS su
  		FROM \`tenants_locales\` tl JOIN \`tenants\` t ON t.id = tl._parent_id
  		WHERE t.slug = ${slug} AND tl._locale = ${locale};`)
  const emergencyOf = (slug: string) => scalar<string | null>(sql`SELECT contact_emergency_number AS v FROM \`tenants\` WHERE slug = ${slug};`)
  const phones = () => rows(sql`SELECT slug || ':' || COALESCE(contact_phone,'') AS v FROM \`tenants\` ORDER BY slug;`).then((r) => r.map((x) => String(x.v)))

  const hospArBefore = await snap('hosp', 'ar')
  const hospEnBefore = await snap('hosp', 'en')
  const clinicArBefore = await snap('clinic', 'ar')
  const hospEmBefore = await emergencyOf('hosp')
  const clinicEmBefore = await emergencyOf('clinic')
  const phonesBefore = await phones()
  const tenantCountBefore = await scalar<number>(sql`SELECT COUNT(*) AS v FROM \`tenants\`;`)
  const localeCountBefore = await scalar<number>(sql`SELECT COUNT(*) AS v FROM \`tenants_locales\`;`)

  // ---- B.up: drop contact_emergency_number + the eight hero_* columns ----
  await TARGET_B.up({ db: drizzle(), payload: payload, req: undefined } as never)
  const tenantsCols = (await rows(sql`PRAGMA table_info(\`tenants\`);`)).map((c) => String(c.name))
  assert.equal(tenantsCols.includes('contact_emergency_number'), false, 'B.up must drop contact_emergency_number')
  const localeCols = (await rows(sql`PRAGMA table_info(\`tenants_locales\`);`)).map((c) => String(c.name))
  assert.equal(localeCols.some((c) => c.startsWith('hero_')), false, 'B.up must drop all hero_* columns')
  // Every other column, FK, index, row is preserved through the rebuild.
  assert.deepEqual(await phones(), phonesBefore, 'non-hero tenant columns must survive B.up')
  assert.equal(await scalar<number>(sql`SELECT COUNT(*) AS v FROM \`tenants\`;`), tenantCountBefore)
  assert.equal(await scalar<number>(sql`SELECT COUNT(*) AS v FROM \`tenants_locales\`;`), localeCountBefore)

  // ---- B.down: restore the columns and copy hero+emergency back out of healthcare-settings ----
  await TARGET_B.down({ db: drizzle(), payload: payload, req: undefined } as never)
  const tenantsColsAfter = (await rows(sql`PRAGMA table_info(\`tenants\`);`)).map((c) => String(c.name))
  assert.equal(tenantsColsAfter.includes('contact_emergency_number'), true, 'B.down must restore contact_emergency_number')
  const localeColsAfter = (await rows(sql`PRAGMA table_info(\`tenants_locales\`);`)).map((c) => String(c.name))
  assert.equal(localeColsAfter.filter((c) => c.startsWith('hero_')).length, 8, 'B.down must restore all eight hero_* columns')
  // Healthcare tenant hero + emergency restored byte-for-byte.
  assert.deepEqual(await snap('hosp', 'ar'), hospArBefore)
  assert.deepEqual(await snap('hosp', 'en'), hospEnBefore)
  assert.deepEqual(await snap('clinic', 'ar'), clinicArBefore)
  assert.equal(await emergencyOf('hosp'), hospEmBefore)
  assert.equal(await emergencyOf('clinic'), clinicEmBefore)

  // ---- A.down: drop healthcare_settings entirely ----
  await TARGET.down({ db: drizzle(), payload: payload, req: undefined } as never)
  const remaining = (await rows(sql`SELECT name AS v FROM sqlite_master WHERE type='table' AND name IN ('healthcare_settings', 'healthcare_settings_locales');`)).map((r) => String(r.v))
  assert.deepEqual(remaining, [], 'A.down must drop the healthcare_settings tables')

  // Final: healthcare tenant hero+emergency are still byte-identical (B.down restored them from
  // healthcare_settings before A.down removed it), and all other tenant data is unchanged.
  assert.deepEqual(await snap('hosp', 'ar'), hospArBefore)
  assert.deepEqual(await snap('hosp', 'en'), hospEnBefore)
  assert.deepEqual(await snap('clinic', 'ar'), clinicArBefore)
  assert.equal(await emergencyOf('hosp'), hospEmBefore)
  assert.equal(await emergencyOf('clinic'), clinicEmBefore)
  // Non-healthcare tenants' legacy hero is intentionally discarded (healthcare-vertical; only
  // healthcare tenants were backfilled into healthcare_settings by A) → value columns restored as ''.
  const pharmHero = await snap('pharm', 'ar')
  assert.equal(pharmHero.length, 1)
  const h = pharmHero[0] as Record<string, unknown>
  assert.deepEqual(
    [h.yv, h.dv, h.pv, h.sv],
    ['', '', '', ''],
    'non-healthcare tenant hero values must be empty (discarded) after the round trip',
  )
  assert.deepEqual(await phones(), phonesBefore)
  assert.equal(await scalar<number>(sql`SELECT COUNT(*) AS v FROM \`tenants\`;`), tenantCountBefore)
  assert.equal(await scalar<number>(sql`SELECT COUNT(*) AS v FROM \`tenants_locales\`;`), localeCountBefore)
})

test('C.up moves hero value to a parent number; C.down restores the locale text', async () => {
  if (!TARGET_C || !TARGET_B) throw new Error('migration B/C not found')
  // Earlier tests left the DB at A.down. Re-run A + B so C has hero data to move to the parent.
  await TARGET.up({ db: drizzle(), payload: payload, req: undefined } as never)
  await TARGET_B.up({ db: drizzle(), payload: payload, req: undefined } as never)

  // C.up: value → non-localized number on the parent; locale value columns dropped (unit kept).
  await TARGET_C.up({ db: drizzle(), payload: payload, req: undefined } as never)
  const hsCols = (await rows(sql`PRAGMA table_info(\`healthcare_settings\`);`)).map((c) => String(c.name))
  assert.ok(
    ['years', 'departments', 'patients', 'staff'].every((s) => hsCols.includes(`hero_${s}_value`)),
    'parent must carry the 4 numeric value columns',
  )
  const locCols = (await rows(sql`PRAGMA table_info(\`healthcare_settings_locales\`);`)).map((c) => String(c.name))
  assert.equal(locCols.some((c) => c.endsWith('_value')), false, 'locale value columns must be dropped')
  assert.ok(locCols.includes('hero_years_unit'), 'locale unit columns must remain')

  // Parent numbers parsed from the ar locale (seed: 67 / 28 / 1.2 / 2400).
  const v = await rows(sql`SELECT \`hero_years_value\` AS y, \`hero_departments_value\` AS d, \`hero_patients_value\` AS p, \`hero_staff_value\` AS s FROM \`healthcare_settings\` hs JOIN \`tenants\` t ON t.id = hs.tenant_id WHERE t.slug = 'hosp';`)
  assert.equal(v[0]?.y, 67)
  assert.equal(v[0]?.d, 28)
  assert.equal(v[0]?.p, 1.2)
  assert.equal(v[0]?.s, 2400)

  // C.down: restore the locale value text; drop the parent numeric columns.
  await TARGET_C.down({ db: drizzle(), payload: payload, req: undefined } as never)
  const hsColsAfter = (await rows(sql`PRAGMA table_info(\`healthcare_settings\`);`)).map((c) => String(c.name))
  assert.equal(hsColsAfter.some((c) => c.endsWith('_value')), false, 'parent numeric columns must be dropped')
  const locColsAfter = (await rows(sql`PRAGMA table_info(\`healthcare_settings_locales\`);`)).map((c) => String(c.name))
  assert.ok(locColsAfter.includes('hero_years_value'), 'locale value column must be restored')

  // Leave the DB at the pre-A state.
  await TARGET_B.down({ db: drizzle(), payload: payload, req: undefined } as never)
  await TARGET.down({ db: drizzle(), payload: payload, req: undefined } as never)
})
