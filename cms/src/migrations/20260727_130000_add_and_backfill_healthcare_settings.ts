import type { MigrateUpArgs, MigrateDownArgs } from '@payloadcms/db-sqlite'
import { sql } from '@payloadcms/db-sqlite'

// Migration A — introduce the tenant-scoped `healthcare-settings` vertical-settings collection and
// backfill exactly one document per existing healthcare tenant (hospital + clinic), byte-copying the
// hero statistics (the eight localized value/unit pairs) and the emergency number off
// `tenants`/`tenants_locales`. Additive only: the legacy `tenants.hero_*` and
// `tenants.contact_emergency_number` columns are left intact so Migration B's down() can restore
// them from this new table.
//
// One settings row per tenant is enforced twice: the readable `singlePerTenant` beforeChange hook
// (catches the common case) and the UNIQUE(tenant_id) index created here (decides the create/create
// race the hook alone leaves open). Also grants the new `healthcare` feature to every hospital/clinic
// tenant and tenant-type — appended at the end of each feature order, never overwriting existing rows.
//
// SQL assertions throw on any coverage/feature drift so the migration transaction rolls back. The
// pre-check before the feature inserts guarantees `healthcare` was absent beforehand, so down() may
// delete every `healthcare` feature row unconditionally (it is all migration-owned).

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // --- 1. healthcare_settings (one row per tenant) + localized hero-stats table. AUTOINCREMENT PKs
  //        match the db config (autoIncrement: true) and the commerce_settings precedent. ---
  await db.run(sql`CREATE TABLE \`healthcare_settings\` (
  	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  	\`emergency_number\` text,
  	\`tenant_id\` integer REFERENCES \`tenants\`(\`id\`),
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  // UNIQUE(tenant_id): one settings document per tenant; also serves tenant lookups (mirrors
  // commerce_settings_tenant_uniq — no separate non-unique _tenant_idx is needed).
  await db.run(sql`CREATE UNIQUE INDEX \`healthcare_settings_tenant_unique\` ON \`healthcare_settings\` (\`tenant_id\`);`)
  await db.run(sql`CREATE INDEX \`healthcare_settings_updated_at_idx\` ON \`healthcare_settings\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`healthcare_settings_created_at_idx\` ON \`healthcare_settings\` (\`created_at\`);`)

  await db.run(sql`CREATE TABLE \`healthcare_settings_locales\` (
  	\`hero_years_value\` text NOT NULL,
  	\`hero_years_unit\` text,
  	\`hero_departments_value\` text NOT NULL,
  	\`hero_departments_unit\` text,
  	\`hero_patients_value\` text NOT NULL,
  	\`hero_patients_unit\` text,
  	\`hero_staff_value\` text NOT NULL,
  	\`hero_staff_unit\` text,
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`_locale\` text NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`healthcare_settings\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`healthcare_settings_locales_locale_parent_id_unique\` ON \`healthcare_settings_locales\` (\`_locale\`,\`_parent_id\`);`)

  // Document-lock relationship column (see commerce_settings_events migration for rationale:
  // missing it makes the document-lock query throw on update).
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`healthcare_settings_id\` integer REFERENCES healthcare_settings(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_healthcare_settings_id_idx\` ON \`payload_locked_documents_rels\` (\`healthcare_settings_id\`);`)

  // --- 2. Backfill one parent row per hospital/clinic tenant: copy the emergency number, preserve
  //        the tenant timestamps. The unique index enforces one-per-tenant during the insert. ---
  await db.run(sql`INSERT INTO \`healthcare_settings\` (\`emergency_number\`, \`tenant_id\`, \`updated_at\`, \`created_at\`)
  	SELECT t.\`contact_emergency_number\`, t.\`id\`, t.\`updated_at\`, t.\`created_at\`
  	FROM \`tenants\` t
  	JOIN \`tenant_types\` tt ON tt.\`id\` = t.\`type_id\`
  	WHERE tt.\`slug\` IN ('hospital', 'clinic');`)

  // --- 3. Copy every eligible tenant-locale row, mapping the eight hero columns + preserving _locale. ---
  await db.run(sql`INSERT INTO \`healthcare_settings_locales\` (
  		\`hero_years_value\`, \`hero_years_unit\`,
  		\`hero_departments_value\`, \`hero_departments_unit\`,
  		\`hero_patients_value\`, \`hero_patients_unit\`,
  		\`hero_staff_value\`, \`hero_staff_unit\`,
  		\`_locale\`, \`_parent_id\`
  	)
  	SELECT
  		tl.\`hero_years_value\`, tl.\`hero_years_unit\`,
  		tl.\`hero_departments_value\`, tl.\`hero_departments_unit\`,
  		tl.\`hero_patients_value\`, tl.\`hero_patients_unit\`,
  		tl.\`hero_staff_value\`, tl.\`hero_staff_unit\`,
  		tl.\`_locale\`, hs.\`id\`
  	FROM \`tenants_locales\` tl
  	JOIN \`tenants\` t ON t.\`id\` = tl.\`_parent_id\`
  	JOIN \`tenant_types\` tt ON tt.\`id\` = t.\`type_id\`
  	JOIN \`healthcare_settings\` hs ON hs.\`tenant_id\` = t.\`id\`
  	WHERE tt.\`slug\` IN ('hospital', 'clinic');`)

  // --- 4. Pre-check: `healthcare` must be absent from both feature tables. This feature is new, so
  //        any pre-existing row is drift; stopping here keeps down() able to delete only rows this
  //        migration owns. ---
  await db.run(sql`CREATE TEMP TABLE \`_hs_feat_absent\` (\`n\` integer NOT NULL CHECK (\`n\` = 0));`)
  await db.run(sql`INSERT INTO \`_hs_feat_absent\` (\`n\`)
  	SELECT
  		(SELECT COUNT(*) FROM \`tenants_features\` WHERE \`value\` = 'healthcare') +
  		(SELECT COUNT(*) FROM \`tenant_types_default_features\` WHERE \`value\` = 'healthcare');`)
  await db.run(sql`DROP TABLE \`_hs_feat_absent\`;`)

  // --- 5. Grant `healthcare` to hospital/clinic tenant-types (the default template), appended at the
  //        end of each type's feature order, only when absent. COALESCE(MAX+1, 0) keeps ordering contiguous. ---
  await db.run(sql`INSERT INTO \`tenant_types_default_features\` (\`order\`, \`parent_id\`, \`value\`)
  	SELECT
  		COALESCE((SELECT MAX(tdf.\`order\`) FROM \`tenant_types_default_features\` tdf WHERE tdf.\`parent_id\` = tt.\`id\`), -1) + 1,
  		tt.\`id\`,
  		'healthcare'
  	FROM \`tenant_types\` tt
  	WHERE tt.\`slug\` IN ('hospital', 'clinic')
  		AND NOT EXISTS (
  			SELECT 1 FROM \`tenant_types_default_features\` existing
  			WHERE existing.\`parent_id\` = tt.\`id\` AND existing.\`value\` = 'healthcare'
  		);`)

  // --- 6. Grant `healthcare` to every hospital/clinic tenant, appended at the end of its feature order. ---
  await db.run(sql`INSERT INTO \`tenants_features\` (\`order\`, \`parent_id\`, \`value\`)
  	SELECT
  		COALESCE((SELECT MAX(tf.\`order\`) FROM \`tenants_features\` tf WHERE tf.\`parent_id\` = t.\`id\`), -1) + 1,
  		t.\`id\`,
  		'healthcare'
  	FROM \`tenants\` t
  	JOIN \`tenant_types\` tt ON tt.\`id\` = t.\`type_id\`
  	WHERE tt.\`slug\` IN ('hospital', 'clinic')
  		AND NOT EXISTS (
  			SELECT 1 FROM \`tenants_features\` existing
  			WHERE existing.\`parent_id\` = t.\`id\` AND existing.\`value\` = 'healthcare'
  		);`)

  // --- 7. Coverage + feature assertions. Each guard inserts a mismatch count into a CHECK(n=0) temp
  //        table; any non-zero count aborts the statement and rolls the whole migration back. ---

  // (a) one healthcare_settings parent per eligible tenant
  await db.run(sql`CREATE TEMP TABLE \`_hs_guard_parents\` (\`n\` integer NOT NULL CHECK (\`n\` = 0));`)
  await db.run(sql`INSERT INTO \`_hs_guard_parents\` (\`n\`)
  	SELECT ABS(
  		(SELECT COUNT(*) FROM \`tenants\` t JOIN \`tenant_types\` tt ON tt.\`id\` = t.\`type_id\` WHERE tt.\`slug\` IN ('hospital', 'clinic'))
  		- (SELECT COUNT(*) FROM \`healthcare_settings\`)
  	);`)
  await db.run(sql`DROP TABLE \`_hs_guard_parents\`;`)

  // (b) one healthcare_settings_locales row per eligible tenant-locale
  await db.run(sql`CREATE TEMP TABLE \`_hs_guard_locales\` (\`n\` integer NOT NULL CHECK (\`n\` = 0));`)
  await db.run(sql`INSERT INTO \`_hs_guard_locales\` (\`n\`)
  	SELECT ABS(
  		(SELECT COUNT(*) FROM \`tenants_locales\` tl
  			JOIN \`tenants\` t ON t.\`id\` = tl.\`_parent_id\`
  			JOIN \`tenant_types\` tt ON tt.\`id\` = t.\`type_id\`
  			WHERE tt.\`slug\` IN ('hospital', 'clinic'))
  		- (SELECT COUNT(*) FROM \`healthcare_settings_locales\`)
  	);`)
  await db.run(sql`DROP TABLE \`_hs_guard_locales\`;`)

  // (c) feature grant: exactly once on every eligible tenant/type, never on a non-eligible one
  await db.run(sql`CREATE TEMP TABLE \`_hs_guard_features\` (\`n\` integer NOT NULL CHECK (\`n\` = 0));`)
  await db.run(sql`INSERT INTO \`_hs_guard_features\` (\`n\`)
  	SELECT
  		(SELECT COUNT(*) FROM \`tenants\` t JOIN \`tenant_types\` tt ON tt.\`id\` = t.\`type_id\`
  			WHERE tt.\`slug\` IN ('hospital', 'clinic')
  				AND (SELECT COUNT(*) FROM \`tenants_features\` tf WHERE tf.\`parent_id\` = t.\`id\` AND tf.\`value\` = 'healthcare') <> 1)
  		+ (SELECT COUNT(*) FROM \`tenants\` t JOIN \`tenant_types\` tt ON tt.\`id\` = t.\`type_id\`
  			WHERE tt.\`slug\` NOT IN ('hospital', 'clinic')
  				AND EXISTS (SELECT 1 FROM \`tenants_features\` tf WHERE tf.\`parent_id\` = t.\`id\` AND tf.\`value\` = 'healthcare'))
  		+ (SELECT COUNT(*) FROM \`tenant_types\` tt
  			WHERE tt.\`slug\` IN ('hospital', 'clinic')
  				AND (SELECT COUNT(*) FROM \`tenant_types_default_features\` tdf WHERE tdf.\`parent_id\` = tt.\`id\` AND tdf.\`value\` = 'healthcare') <> 1)
  		+ (SELECT COUNT(*) FROM \`tenant_types\` tt
  			WHERE tt.\`slug\` NOT IN ('hospital', 'clinic')
  				AND EXISTS (SELECT 1 FROM \`tenant_types_default_features\` tdf WHERE tdf.\`parent_id\` = tt.\`id\` AND tdf.\`value\` = 'healthcare'));`)
  await db.run(sql`DROP TABLE \`_hs_guard_features\`;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // Reverse ONLY what this migration added. Legacy tenants hero/emergency columns are untouched
  // (Migration B owns their removal + restoration). Because the up() pre-check guaranteed `healthcare`
  // was absent before this migration ran, every `healthcare` feature row is migration-owned and safe
  // to delete unconditionally.
  await db.run(sql`DELETE FROM \`tenants_features\` WHERE \`value\` = 'healthcare';`)
  await db.run(sql`DELETE FROM \`tenant_types_default_features\` WHERE \`value\` = 'healthcare';`)

  await db.run(sql`DROP TABLE IF EXISTS \`healthcare_settings_locales\`;`)
  // Drop the lock-rel column (and its index) BEFORE the parent table. payload migrate runs each
  // migration in a transaction with foreign_keys ON, so DROP TABLE healthcare_settings would
  // otherwise fire the rel FK's implicit DELETE (NO ACTION) and abort if any lock-rel row still
  // references a healthcare_settings id. Removing the column first drops that FK reference.
  await db.run(sql`DROP INDEX IF EXISTS \`payload_locked_documents_rels_healthcare_settings_id_idx\`;`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` DROP COLUMN \`healthcare_settings_id\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`healthcare_settings\`;`)
}
