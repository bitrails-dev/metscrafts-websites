// One-off prerequisite tool (per-tenant-languages §0.5/§10): regenerate the standalone Drizzle
// snapshot JSON for the CURRENT schema state (= post-migration 130100 = HEAD), using Payload's own
// authentic code path — drizzle-kit's `generateSQLiteDrizzleJson(payload.db.schema)`. This is the
// exact call `buildCreateMigration` makes to write the .json, minus the interactive rename-diff
// (which can't run in a non-TTY shell). Writes the snapshot to the path given as argv[2].
//
// NEVER fabricate a snapshot by hand — this tool exists so the prerequisite snapshots are produced
// by the same drizzle-kit serializer Payload itself uses. Run:
//   pnpm --filter @bitrails-works/cms exec tsx scripts/snapshot-current-schema.ts <out.json>
import 'dotenv/config'
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import payload from 'payload'
import config from '../src/payload.config'

const require = createRequire(import.meta.url)
// drizzle-kit/api is CJS; load the sqlite serializer the same way @payloadcms/drizzle does
// (see dist/sqlite/requireDrizzleKit.js).
const { generateSQLiteDrizzleJson } = require('drizzle-kit/api') as {
  generateSQLiteDrizzleJson: (schema: unknown) => Promise<Record<string, unknown>>
}

const out = process.argv[2]
if (!out) {
  console.error('usage: tsx scripts/snapshot-current-schema.ts <out.json>')
  process.exit(1)
}

// disableDBConnect + disableOnInit mirror `payload migrate:create` (bin/migrate.js): the schema is
// built from the config, no DB connection or migration apply happens. Safe — never touches cms.db.
await payload.init({ config, disableDBConnect: true, disableOnInit: true })

const schema = (payload as unknown as { db: { schema: unknown } }).db.schema
const snapshot = await generateSQLiteDrizzleJson(schema)
writeFileSync(out, JSON.stringify(snapshot, null, 2))
console.log('WROTE', out, 'id=', (snapshot as { id?: string }).id, 'tables=', Object.keys((snapshot as { tables?: object }).tables ?? {}).length)

try {
  await (payload as unknown as { destroy: () => Promise<void> }).destroy()
} catch {
  /* libsql teardown */
}
