import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-sqlite'

// A hasMany select is persisted in a join table. Older tenant rows can contain the same locale
// more than once, which makes the admin control render e.g. Arabic, Arabic, English, English.
// Keep the first stored row for each tenant/locale, then restore the array order to zero-based
// contiguous values before adding the database guard for future raw writes.
export async function deduplicateTenantLanguages(db: MigrateUpArgs['db']): Promise<void> {
  await db.run(sql`
    DELETE FROM tenants_languages
    WHERE id NOT IN (
      SELECT MIN(id)
      FROM tenants_languages
      GROUP BY parent_id, value
    );
  `)

  await db.run(sql`
    WITH ordered AS (
      SELECT id,
        ROW_NUMBER() OVER (PARTITION BY parent_id ORDER BY \"order\", id) - 1 AS next_order
      FROM tenants_languages
    )
    UPDATE tenants_languages
    SET \"order\" = (
      SELECT next_order FROM ordered WHERE ordered.id = tenants_languages.id
    );
  `)
}

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await deduplicateTenantLanguages(db)
  await db.run(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS tenants_languages_parent_value_unique_idx
    ON tenants_languages (parent_id, value);
  `)
}

// This migration removes data that is semantically duplicated. It cannot recreate the deleted
// duplicate rows on rollback, but dropping the guard keeps the schema rollback-compatible.
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`
    DROP INDEX IF EXISTS tenants_languages_parent_value_unique_idx;
  `)
}
