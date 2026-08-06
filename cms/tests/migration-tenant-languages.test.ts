// T5 (plan §9 / §10.6) — tenant_languages migration: schema `up` once + backfill idempotency + `down`.
//
// One cohesive cycle on a throwaway DB:
//   setup: reach the PRE-tenant_languages state WITH tenant rows. `payload.db.migrate()` brings the
//          DB to HEAD (languages table/column already applied, empty); seed ≥2 tenants; then call the
//          migration's `down` ONCE as setup — this drops ONLY tenants_languages +
//          tenants.default_language, leaving the tenant rows intact. Now the DB is at the
//          pre-tenant_languages state with real tenant rows.
//   1. up({db}) ONCE                 → creates schema + runs the 1st backfill
//   2. backfillTenantLanguages(db)   → 2nd time; must be a no-op (idempotency proof)
//   3. down({db}) ONCE               → drops the table + column again; clean
//
// `up`'s generated DDL runs exactly once across the whole test (the setup step is migration `down`,
// never `up`). The 2nd backfill is the extracted function, not `up` — so generated DDL is never
// called twice (plan §10.6).
//
// One Payload instance + one throwaway DB per file (Windows + libSQL isolation — see
// cms/tests/commerce-migration-additive.test.ts).

import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import test from 'node:test'
import type { Payload } from 'payload'

import { sql } from '@payloadcms/db-sqlite'
import type { MigrateUpArgs, MigrateDownArgs } from '@payloadcms/db-sqlite'
import { seedTenant } from './helpers/commerce'
import { makeTempDbPath, drizzleFrom } from './fixtures/throwaway-db'
import type { DB } from './fixtures/legacy-seed'
import { up, down, backfillTenantLanguages } from '../src/migrations/20260728_105552_tenant_languages'
import { deduplicateTenantLanguages } from '../src/migrations/20260805_120000_deduplicate_tenant_languages'

const TEMP_DB = makeTempDbPath('migration-tenant-languages')
process.env.DATABASE_URI = `file:${TEMP_DB}`
process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'migration-tenant-languages-secret'

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')
const payload = (await getPayload({ config })) as unknown as Payload
await payload.db.migrate()
const db: DB = drizzleFrom(payload)

test.after(async () => {
  try { await payload.destroy() } catch { /* disposable */ }
  try { rmSync(TEMP_DB, { force: true }) } catch { /* ignore */ }
})

// The migration functions are typed against the full Drizzle handle (`MigrateUpArgs['db']`) +
// PayloadRequest; in the test we only have the loose DB handle and no reachable `req`. The migration
// bodies use `db` alone, so cast through unknown. `payload` is the real instance.
const drizzleDb = db as unknown as MigrateUpArgs['db']
const upArgs = { db: drizzleDb, payload, req: undefined } as unknown as MigrateUpArgs
const downArgs = { db: drizzleDb, payload, req: undefined } as unknown as MigrateDownArgs

test('T5: up creates schema + backfills every tenant; 2nd backfill is idempotent; down cleans', async () => {
  // ── Setup: seed ≥2 tenants at HEAD, then `down` once → PRE-state WITH tenant rows ────────
  const tenantA = await seedTenant(payload)
  const tenantB = await seedTenant(payload)
  const seededIds = [tenantA.tenantId, tenantB.tenantId]

  // Setup-down (NOT the test's down): drops ONLY tenants_languages + tenants.default_language.
  // Tenant rows remain → we are now at the pre-tenant_languages state with real tenant rows.
  await down(downArgs)

  // Sanity: confirm the pre-state.
  {
    const table = await db.run(sql`SELECT name FROM sqlite_master WHERE type='table' AND name='tenants_languages';`)
    assert.equal((table.rows as Array<{ name?: string }>).length, 0, 'pre-state: tenants_languages table absent')
    const cols = (await db.run(sql`PRAGMA table_info(tenants);`)).rows as Array<{ name: string }>
    assert.ok(!cols.some((c) => c.name === 'default_language'), 'pre-state: tenants.default_language absent')
    const cnt = await db.run(sql`SELECT COUNT(*) AS v FROM tenants;`)
    assert.ok(Number((cnt.rows[0] as { v: unknown }).v ?? 0) >= 2, 'pre-state: seeded tenants present')
  }

  // ── 1. up() ONCE → creates schema + runs the 1st backfill ────────────────────────────────
  await up(upArgs)

  // 1a. Schema: tenants_languages table exists with order/parent_id/value/id.
  {
    const table = await db.run(sql`SELECT name FROM sqlite_master WHERE type='table' AND name='tenants_languages';`)
    assert.equal((table.rows as Array<{ name?: string }>).length, 1, 'up: tenants_languages table created')
    const cols = (await db.run(sql`PRAGMA table_info(tenants_languages);`)).rows as Array<{ name: string }>
    const names = cols.map((c) => c.name).sort()
    for (const required of ['order', 'parent_id', 'value', 'id']) {
      assert.ok(names.includes(required), `up: tenants_languages has column '${required}'; cols=${JSON.stringify(names)}`)
    }
  }
  // 1b. Schema: tenants.default_language column exists.
  {
    const cols = (await db.run(sql`PRAGMA table_info(tenants);`)).rows as Array<{ name: string }>
    assert.ok(cols.some((c) => c.name === 'default_language'), 'up: tenants.default_language column added')
  }
  // 1c. Rows: EVERY tenant got default_language='ar' + exactly two language rows.
  const totalTenants = Number(((await db.run(sql`SELECT COUNT(*) AS v FROM tenants;`)).rows[0] as { v: unknown }).v ?? 0)
  {
    const rows = (await db.run(sql`
      SELECT t.id AS tid, t.default_language AS dl,
             (SELECT COUNT(*) FROM tenants_languages l WHERE l.parent_id = t.id) AS lang_count
      FROM tenants t;
    `)).rows as Array<{ tid: number | string; dl: string | null; lang_count: number }>
    assert.equal(rows.length, totalTenants, 'one row per tenant')
    for (const r of rows) {
      assert.equal(r.dl, 'ar', `tenant ${r.tid}: default_language='ar' after 1st backfill`)
      assert.equal(r.lang_count, 2, `tenant ${r.tid}: exactly 2 language rows after 1st backfill`)
    }
  }
  // 1d. Specific seeded tenants: values/orders are exactly ar@0, en@1.
  for (const tid of seededIds) {
    const langs = (await db.run(sql`
      SELECT value, "order" AS ord FROM tenants_languages
      WHERE parent_id = ${tid} ORDER BY "order";
    `)).rows as Array<{ value: string; ord: number }>
    assert.deepEqual(langs, [{ value: 'ar', ord: 0 }, { value: 'en', ord: 1 }],
      `tenant ${tid}: languages are [ar@0, en@1] after 1st backfill`)
  }
  const totalLangRowsAfterUp = Number(((await db.run(sql`SELECT COUNT(*) AS v FROM tenants_languages;`)).rows[0] as { v: unknown }).v ?? 0)
  assert.equal(totalLangRowsAfterUp, totalTenants * 2, 'up: exactly 2 language rows per tenant across the table')

  // ── 2. backfillTenantLanguages(db) AGAIN → idempotent (no dups, no value changes) ────────
  await backfillTenantLanguages(drizzleDb)

  {
    const rows = (await db.run(sql`
      SELECT t.id AS tid, t.default_language AS dl,
             (SELECT COUNT(*) FROM tenants_languages l WHERE l.parent_id = t.id) AS lang_count
      FROM tenants t;
    `)).rows as Array<{ tid: number | string; dl: string | null; lang_count: number }>
    for (const r of rows) {
      assert.equal(r.dl, 'ar', `tenant ${r.tid}: default_language still 'ar' after 2nd backfill`)
      assert.equal(r.lang_count, 2, `tenant ${r.tid}: still exactly 2 language rows (no duplicates)`)
    }
  }
  for (const tid of seededIds) {
    const langs = (await db.run(sql`
      SELECT value, "order" AS ord FROM tenants_languages
      WHERE parent_id = ${tid} ORDER BY "order";
    `)).rows as Array<{ value: string; ord: number }>
    assert.deepEqual(langs, [{ value: 'ar', ord: 0 }, { value: 'en', ord: 1 }],
      `tenant ${tid}: language values unchanged after 2nd backfill`)
  }
  const totalLangRowsAfterReBackfill = Number(((await db.run(sql`SELECT COUNT(*) AS v FROM tenants_languages;`)).rows[0] as { v: unknown }).v ?? 0)
  assert.equal(totalLangRowsAfterReBackfill, totalLangRowsAfterUp, '2nd backfill added zero rows (idempotent)')

  // A legacy database can already contain duplicate join rows. The cleanup migration keeps one
  // row per locale and restores the order values that the admin hasMany control expects.
  await db.run(sql`
    INSERT INTO tenants_languages (\`order\`, parent_id, value)
    VALUES (20, ${seededIds[0]}, 'ar'), (21, ${seededIds[0]}, 'en');
  `)
  await deduplicateTenantLanguages(drizzleDb)
  const cleaned = (await db.run(sql`
    SELECT value, \"order\" AS ord FROM tenants_languages
    WHERE parent_id = ${seededIds[0]} ORDER BY \"order\";
  `)).rows as Array<{ value: string; ord: number }>
  assert.deepEqual(cleaned, [{ value: 'ar', ord: 0 }, { value: 'en', ord: 1 }],
    'duplicate tenant locales are cleaned and re-ordered')

  // ── 3. down() ONCE → clean ───────────────────────────────────────────────────────────────
  await down(downArgs)

  {
    const table = await db.run(sql`SELECT name FROM sqlite_master WHERE type='table' AND name='tenants_languages';`)
    assert.equal((table.rows as Array<{ name?: string }>).length, 0, 'down: tenants_languages table dropped')
    const cols = (await db.run(sql`PRAGMA table_info(tenants);`)).rows as Array<{ name: string }>
    assert.ok(!cols.some((c) => c.name === 'default_language'), 'down: tenants.default_language column dropped')
  }
})
