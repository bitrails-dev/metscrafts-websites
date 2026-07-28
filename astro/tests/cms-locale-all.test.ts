// T16 — CMS backends read all locales with fallback disabled (§9 + §2.2 item 4).
// REST URL must contain `locale=all&fallback-locale=none`; Local API find() must pass
// `locale:'all'` and `fallbackLocale:false`. Coordinated with the CMS-backend edits
// (cms/api/index.ts + cms/in-process/index.ts); if those source edits aren't visible yet
// when this test runs, both subtests will fail pending the sweep — that's expected and
// tracked by the orchestrator, not a defect in this file.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const here = resolve(fileURLToPath(new URL('.', import.meta.url)))
const apiSrc = readFileSync(resolve(here, '..', 'src', 'cms', 'api', 'index.ts'), 'utf8')
const inProcessSrc = readFileSync(resolve(here, '..', 'src', 'cms', 'in-process', 'index.ts'), 'utf8')

test('REST backend URL contains locale=all&fallback-locale=none', () => {
  // Reading localized tenant maps must request every locale AND disable Payload's
  // per-locale fallback so the platform default doesn't pre-fill missing tenant values.
  assert.ok(
    /locale=all&fallback-locale=none/.test(apiSrc),
    'REST URL must request ?locale=all&fallback-locale=none (cms/api/index.ts)',
  )
})

test('Local API backend passes locale:"all"', () => {
  assert.ok(
    /locale:\s*['"]all['"]/.test(inProcessSrc),
    'in-process find() must pass locale:"all" (cms/in-process/index.ts)',
  )
})

test('Local API backend passes fallbackLocale:false', () => {
  assert.ok(
    /fallbackLocale:\s*false/.test(inProcessSrc),
    'in-process find() must pass fallbackLocale:false (cms/in-process/index.ts)',
  )
})
