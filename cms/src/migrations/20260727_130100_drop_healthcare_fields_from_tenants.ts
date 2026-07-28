import type { MigrateUpArgs, MigrateDownArgs } from '@payloadcms/db-sqlite'
import { sql } from '@payloadcms/db-sqlite'

// Migration B — drop the legacy healthcare fields now owned by `healthcare-settings`: the
// `tenants.contact_emergency_number` column and the eight `tenants_locales.hero_*` columns.
//
// Uses SQLite ALTER TABLE DROP/ADD COLUMN (3.35+) instead of a table-rebuild. A rebuild would
// `DROP TABLE tenants`, which — inside `payload migrate`'s transaction, where PRAGMA
// foreign_keys=OFF is a no-op — fires `users_tenants.tenant_id`'s ON DELETE SET NULL cascade and
// aborts with a NOT NULL violation as soon as any user is assigned to a tenant. DROP COLUMN never
// drops the table, so the cascade cannot fire; it also preserves every other column, FK, index,
// locale row, id, and timestamp with no copy step.
//
// `up()` asserts healthcare-settings coverage BEFORE dropping: every hospital/clinic tenant must
// already have a healthcare_settings row (Migration A backfilled it). `down()` restores the columns
// and copies emergency + the eight hero columns back out of healthcare-settings by tenant/locale, so
// a rollback returns the site to serving hero/emergency from `tenants`.

const HERO_LOCALE_COLUMNS = [
  'hero_years_value', 'hero_years_unit',
  'hero_departments_value', 'hero_departments_unit',
  'hero_patients_value', 'hero_patients_unit',
  'hero_staff_value', 'hero_staff_unit',
] as const

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // --- 0. Coverage guard: every hospital/clinic tenant MUST already have a healthcare_settings row. ---
  await db.run(sql`CREATE TEMP TABLE \`_b_coverage\` (\`n\` integer NOT NULL CHECK (\`n\` = 0));`)
  await db.run(sql`INSERT INTO \`_b_coverage\` (\`n\`)
  	SELECT COUNT(*)
  	FROM \`tenants\` t
  	JOIN \`tenant_types\` tt ON tt.\`id\` = t.\`type_id\`
  	WHERE tt.\`slug\` IN ('hospital', 'clinic')
  		AND NOT EXISTS (SELECT 1 FROM \`healthcare_settings\` hs WHERE hs.\`tenant_id\` = t.\`id\`);`)
  await db.run(sql`DROP TABLE \`_b_coverage\`;`)

  // --- 1. Drop the legacy emergency column + the eight hero locale columns. None are indexed, PK,
  //        UNIQUE, or CHECK-constrained, so DROP COLUMN is a metadata-only change.
  //        NOTE: hero + emergency_number are healthcare-vertical fields. Migration A backfilled only
  //        hospital/clinic tenants into healthcare_settings, so a non-healthcare tenant's legacy
  //        values in these columns are discarded here (by design — they are not healthcare data) and
  //        restored as defaults ('' / NULL) on rollback. ---
  await db.run(sql`ALTER TABLE \`tenants\` DROP COLUMN \`contact_emergency_number\`;`)
  for (const col of HERO_LOCALE_COLUMNS) {
    await db.run(sql`ALTER TABLE \`tenants_locales\` DROP COLUMN ${sql.identifier(col)};`)
  }
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // --- 1. Restore the legacy columns. ADD COLUMN keeps every existing row and the table identity
  //        intact (no rebuild → no users_tenants cascade). NOT NULL value columns carry DEFAULT '' so
  //        the ADD succeeds for existing rows; the backfill below overwrites them with real values. ---
  await db.run(sql`ALTER TABLE \`tenants\` ADD COLUMN \`contact_emergency_number\` text;`)
  await db.run(sql`ALTER TABLE \`tenants_locales\` ADD COLUMN \`hero_years_value\` text NOT NULL DEFAULT '';`)
  await db.run(sql`ALTER TABLE \`tenants_locales\` ADD COLUMN \`hero_years_unit\` text;`)
  await db.run(sql`ALTER TABLE \`tenants_locales\` ADD COLUMN \`hero_departments_value\` text NOT NULL DEFAULT '';`)
  await db.run(sql`ALTER TABLE \`tenants_locales\` ADD COLUMN \`hero_departments_unit\` text;`)
  await db.run(sql`ALTER TABLE \`tenants_locales\` ADD COLUMN \`hero_patients_value\` text NOT NULL DEFAULT '';`)
  await db.run(sql`ALTER TABLE \`tenants_locales\` ADD COLUMN \`hero_patients_unit\` text;`)
  await db.run(sql`ALTER TABLE \`tenants_locales\` ADD COLUMN \`hero_staff_value\` text NOT NULL DEFAULT '';`)
  await db.run(sql`ALTER TABLE \`tenants_locales\` ADD COLUMN \`hero_staff_unit\` text;`)

  // --- 2. Copy emergency_number back from healthcare_settings by tenant. ---
  await db.run(sql`UPDATE \`tenants\` SET \`contact_emergency_number\` = (
  	SELECT hs.\`emergency_number\` FROM \`healthcare_settings\` hs WHERE hs.\`tenant_id\` = \`tenants\`.\`id\`
  );`)

  // --- 3. Copy the eight hero columns back from healthcare_settings_locales by tenant+locale.
  //        Non-healthcare locales have no healthcare row → value columns fall back to '' (NOT NULL safe).
  //        Column names are static identifiers (sql.identifier) so they are never bound as parameters. ---
  const heroPair = (valueCol: string, unitCol: string) => sql`
  	${sql.identifier(valueCol)} = COALESCE((SELECT hsl.${sql.identifier(valueCol)} FROM \`healthcare_settings_locales\` hsl JOIN \`healthcare_settings\` hs ON hs.\`id\` = hsl.\`_parent_id\` WHERE hs.\`tenant_id\` = \`tenants_locales\`.\`_parent_id\` AND hsl.\`_locale\` = \`tenants_locales\`.\`_locale\`), ''),
  	${sql.identifier(unitCol)} = (SELECT hsl.${sql.identifier(unitCol)} FROM \`healthcare_settings_locales\` hsl JOIN \`healthcare_settings\` hs ON hs.\`id\` = hsl.\`_parent_id\` WHERE hs.\`tenant_id\` = \`tenants_locales\`.\`_parent_id\` AND hsl.\`_locale\` = \`tenants_locales\`.\`_locale\`)`
  await db.run(sql`UPDATE \`tenants_locales\` SET
  	${heroPair('hero_years_value', 'hero_years_unit')},
  	${heroPair('hero_departments_value', 'hero_departments_unit')},
  	${heroPair('hero_patients_value', 'hero_patients_unit')},
  	${heroPair('hero_staff_value', 'hero_staff_unit')};`)

  // --- 4. Assert every healthcare locale was restored (non-empty hero values for hospital/clinic). ---
  await db.run(sql`CREATE TEMP TABLE \`_b_restore\` (\`n\` integer NOT NULL CHECK (\`n\` = 0));`)
  await db.run(sql`INSERT INTO \`_b_restore\` (\`n\`)
  	SELECT COUNT(*)
  	FROM \`tenants_locales\` tl
  	JOIN \`tenants\` t ON t.\`id\` = tl.\`_parent_id\`
  	JOIN \`tenant_types\` tt ON tt.\`id\` = t.\`type_id\`
  	WHERE tt.\`slug\` IN ('hospital', 'clinic')
  		AND (tl.\`hero_years_value\` = '' OR tl.\`hero_departments_value\` = ''
  			OR tl.\`hero_patients_value\` = '' OR tl.\`hero_staff_value\` = '');`)
  await db.run(sql`DROP TABLE \`_b_restore\`;`)
}
