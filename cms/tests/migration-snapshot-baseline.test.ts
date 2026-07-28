import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const snapshotURL = new URL(
  '../src/migrations/20260727_130100_drop_healthcare_fields_from_tenants.json',
  import.meta.url,
)

test('130100 snapshot is the complete schema baseline for tenant languages', () => {
  const snapshot = JSON.parse(readFileSync(snapshotURL, 'utf8'))
  const tables = snapshot.tables as Record<string, any>

  assert.ok(tables.store_products_locales)
  assert.ok(tables.healthcare_settings)
  assert.ok(tables.healthcare_settings_locales)
  assert.ok(tables.store_orders_rels.columns.store_transactions_id)
  assert.equal(tables.store_orders_rels.columns.transactions_id, undefined)
  const transactionFK = Object.values(tables.store_orders_rels.foreignKeys).find(
    (fk: any) => fk.columnsFrom?.includes('store_transactions_id'),
  ) as any
  assert.equal(transactionFK?.tableTo, 'store_transactions')

  assert.equal(tables.tenants.columns.contact_emergency_number, undefined)
  for (const column of [
    'hero_years_value', 'hero_years_unit',
    'hero_departments_value', 'hero_departments_unit',
    'hero_patients_value', 'hero_patients_unit',
    'hero_staff_value', 'hero_staff_unit',
  ]) assert.equal(tables.tenants_locales.columns[column], undefined, column)
})
