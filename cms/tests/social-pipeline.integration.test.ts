// End-to-end wiring check for social auto-publish (the one thing the mocked unit tests cannot prove):
// that the REAL Payload config boots on SQLite, the Article afterChange hook fires on create, and a
// durable `social-publish-article` job row lands in payload_jobs carrying the frozen target snapshot.
// Job EXECUTION (decrypt → adapter → publication row) is covered by the social-job unit tests with a
// mocked Payload; this test stops at the enqueue boundary so it is offline + deterministic (no
// provider network). A fake connected row is seeded so shouldQueueArticle's included∩connected
// intersection is non-empty — otherwise the hook correctly never enqueues.
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const TEMP_DB = join(tmpdir(), `social-pipeline-itest-${process.pid}-${Date.now()}.db`)
process.env.DATABASE_URI = `file:${TEMP_DB}`
process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'social-pipeline-itest-secret-padding-32'
process.env.SOCIAL_SITE_URL = 'https://dgh.bitrail.dev'

const { sql } = await import('@payloadcms/db-sqlite')
const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')
const { encryptToken } = await import('../src/social/crypto')
const { SOCIAL_PUBLISH_TASK_SLUG, SOCIAL_QUEUE } = await import('../src/social/jobs')

test('Article create enqueues a durable social-publish job on real SQLite', async () => {
  const payload = await getPayload({ config })
  // ponytail: global fetch stubbed so even an unplanned auto-drain can never reach a real provider.
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response('{"error":{"message":"offline"}}', { status: 599 })) as typeof fetch
  try {
    await payload.db.migrate()
    const db = (payload.db as { drizzle: { all: (q: unknown) => Promise<unknown[]> } }).drizzle

    const tenantType = await payload.create({
      collection: 'tenant-types',
      data: { name: 'Hospital', slug: 'hospital-itest' },
      overrideAccess: true,
    })
    // `socialPublishing` is a setting group (not a `features` value); writeable via overrideAccess.
    // Hero stats carry required localized `value` fields, so seed them to satisfy validation.
    const tenant = await payload.create({
      collection: 'tenants',
      data: {
        name: 'itest-tenant', slug: 'itest-tenant', type: tenantType.id,
        hero: {
          years: { value: '1' }, departments: { value: '1' },
          patients: { value: '1' }, staff: { value: '1' },
        },
        socialPublishing: { enabled: true, defaultAutoPublish: true, includedPlatforms: ['facebook'] },
      },
      overrideAccess: true,
    })
    // Seed a connected facebook row so the hook's included∩connected intersection is ['facebook'].
    await payload.create({
      collection: 'social-connections',
      data: {
        tenant: tenant.id, platform: 'facebook', remoteAccountId: 'fake-page',
        remoteAccountLabel: 'Fake Page', status: 'connected',
        encryptedTokens: encryptToken(JSON.stringify({ pageId: 'fake-page', accessToken: 'fake' })),
      },
      overrideAccess: true,
    })

    // autoPublish is intentionally OMITTED — the beforeChange hook must default it from the tenant.
    // The article is created with overrideAccess and no req/user; doc.tenant arrives POPULATED in the
    // afterChange doc, which is the shape that exposed the hook's id-normalization bug.
    const article = await payload.create({
      collection: 'articles',
      data: { slug: 'itest-article', title: 'مقال اختبار', date: new Date().toISOString(), author: 'itest', tenant: tenant.id },
      overrideAccess: true,
    })

    const rows = await db.all(sql`SELECT "task_slug", "queue", "concurrency_key", "input"
      FROM "payload_jobs" WHERE "task_slug" = ${SOCIAL_PUBLISH_TASK_SLUG}`) as Array<{
      task_slug: string; queue: string; concurrency_key: string; input: string
    }>
    assert.equal(rows.length, 1, 'exactly one durable job row was enqueued on Article create')
    const job = rows[0]
    assert.equal(job.queue, SOCIAL_QUEUE)
    assert.equal(job.concurrency_key, `article:${article.id}`, 'per-article exclusive concurrency key')
    const input = JSON.parse(job.input)
    assert.equal(input.tenantId, tenant.id)
    assert.equal(input.articleId, article.id)
    assert.deepEqual(input.platforms, ['facebook'], 'frozen target snapshot captured at create time')
  } finally {
    globalThis.fetch = realFetch
    try { await payload.destroy() } catch { /* disposable temp db */ }
    try { rmSync(TEMP_DB, { force: true }) } catch { /* disposable */ }
  }
})
