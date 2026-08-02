import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

// Idempotent backfill for pre-existing tenants: give every tenant the unresolved-fallback language
// set ([ar, en] — migration-SQL locale literals are the sanctioned exception per §0/§13-C1) and the
// platform default (ar). Re-running is a no-op: the WHERE NOT EXISTS guards prevent duplicate rows
// and the UPDATE is guarded by `IS NULL`. Exported so T5 can assert idempotency directly.
export async function backfillTenantLanguages(db: MigrateUpArgs['db']): Promise<void> {
  await db.run(sql`UPDATE tenants SET default_language = 'ar' WHERE default_language IS NULL;`)
  await db.run(sql`INSERT INTO tenants_languages (\`order\`, parent_id, value)
    SELECT 0, t.id, 'ar' FROM tenants t
    WHERE NOT EXISTS (SELECT 1 FROM tenants_languages l WHERE l.parent_id=t.id AND l.value='ar');`)
  await db.run(sql`INSERT INTO tenants_languages (\`order\`, parent_id, value)
    SELECT 1, t.id, 'en' FROM tenants t
    WHERE NOT EXISTS (SELECT 1 FROM tenants_languages l WHERE l.parent_id=t.id AND l.value='en');`)
}

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`tenants_languages\` (
    \`order\` integer NOT NULL,
    \`parent_id\` integer NOT NULL,
    \`value\` text,
    \`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`tenants\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`tenants_languages_order_idx\` ON \`tenants_languages\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`tenants_languages_parent_idx\` ON \`tenants_languages\` (\`parent_id\`);`)
  await db.run(sql`ALTER TABLE \`tenants\` ADD \`default_language\` text;`)
  await backfillTenantLanguages(db)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP TABLE \`tenants_languages\`;`)
  await db.run(sql`ALTER TABLE \`tenants\` DROP COLUMN \`default_language\`;`)
}
