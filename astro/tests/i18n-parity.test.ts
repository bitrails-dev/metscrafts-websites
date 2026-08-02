// T6 — every astro/src/i18n/messages/<locale>.json has the same key tree as en.json (§9).
// The set of `<locale>.json` basenames must equal `LOCALES`, so a missing `xx.json` fails loudly.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { LOCALES } from '../src/i18n/index'

const here = dirname(fileURLToPath(import.meta.url))
const messagesDir = resolve(here, '..', 'src', 'i18n', 'messages')

const jsonFiles = readdirSync(messagesDir)
  .filter((name) => name.endsWith('.json'))
  .map((name) => name.slice(0, -'.json'.length))

const load = (locale: string): unknown =>
  JSON.parse(readFileSync(resolve(messagesDir, `${locale}.json`), 'utf8'))

// Deep key tree of a locale file — `a.b.c` for every leaf path.
const keyTree = (node: unknown, prefix = ''): string[] => {
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    const entries = Object.entries(node as Record<string, unknown>)
    return entries.flatMap(([k, v]) => {
      const path = prefix ? `${prefix}.${k}` : k
      return v && typeof v === 'object' && !Array.isArray(v) ? keyTree(v, path) : [path]
    })
  }
  return []
}

test('the set of <locale>.json basenames equals LOCALES', () => {
  assert.deepEqual([...jsonFiles].sort(), [...LOCALES].sort())
})

test('every locale JSON has the same key tree as en.json', () => {
  const baseline = keyTree(load('en')).sort()
  assert.ok(baseline.length > 0, 'en.json must be non-empty')
  for (const locale of LOCALES) {
    const tree = keyTree(load(locale)).sort()
    assert.deepEqual(tree, baseline, `key tree for ${locale}.json diverges from en.json`)
  }
})
