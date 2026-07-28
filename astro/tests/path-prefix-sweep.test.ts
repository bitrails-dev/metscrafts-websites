// T13 — §2.4 locale-invariant sweep gate (§9). Drives the sanctioned invariant script and
// asserts each of the four §2.4 `rg` textual gates is empty. NO Vitest: node:test + tsx runtime.
//
// The invariant script (scripts/check-locale-invariants.ts) is the oracle; this test execs it
// via tsx and additionally re-asserts the four §2.4 mandatory rg patterns independently, so a
// regression on either layer (script logic or one of the gated raw patterns) is caught.
//
// Run via `pnpm --filter @bitrails-works/astro exec tsx --test tests/path-prefix-sweep.test.ts`
// (or as part of `test:locales`): pnpm puts both `tsx` and `rg` on PATH via node_modules/.bin.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import test from 'node:test'

// All paths resolve from this test file's URL so the test is cwd-independent.
const astroRoot = new URL('../', import.meta.url)
const srcDir = new URL('src/', astroRoot)
const scriptPath = new URL('scripts/check-locale-invariants.ts', astroRoot)

// Convert a file:// URL to a path Node spawn accepts on the current OS. On Windows, URL.pathname
// starts with a leading `/` before the drive letter (`/C:/...`) which Node rejects; strip it.
function toOsPath(url: URL): string {
  return url.pathname.replace(/^\//, '')
}

// execFileSync bypasses the shell, so patterns are passed to rg verbatim — no shell escaping
// can mangle them. rg returns exit 1 when there are no matches, which we coerce to "".
function runRg(pattern: string, extraArgs: string[]): string {
  try {
    return execFileSync('rg', ['-n', '--pcre2', pattern, toOsPath(srcDir), ...extraArgs], {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    }).trim()
  } catch (err: any) {
    // rg exit 1 = no matches (the success case for these gates).
    if (err.status === 1) return ''
    throw err
  }
}

test('the §2.4 invariant script exits 0 and emits no findings', () => {
  // shell:true so Windows resolves the tsx shim (tsx.CMD). The script path contains no shell
  // metacharacters so this is safe; only rg patterns need verbatim args (handled separately).
  const result = spawnSync('tsx', [toOsPath(scriptPath)], {
    cwd: toOsPath(astroRoot),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    shell: process.platform === 'win32',
  })
  if (result.error) throw result.error
  const { status, stdout, stderr } = result
  assert.equal(status, 0, `invariant script should exit 0, got ${status}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`)
  assert.equal(stdout.trim(), '', `invariant script should emit no findings, got:\n${stdout}`)
  assert.equal(stderr.trim(), '', `invariant script should emit no stderr, got:\n${stderr}`)
})

test('§2.4 gate (a-paired): no two-locale string union anywhere in src', () => {
  // rg -n --pcre2 "['\"]ar['\"]\s*\|\s*['\"]en['\"]" astro/src --glob "*.{ts,astro,vue}"
  const out = runRg("['\"]ar['\"]\\s*\\|\\s*['\"]en['\"]", ['--glob', '*.{ts,astro,vue}'])
  assert.equal(out, '', `two-locale unions must be gone; found:\n${out}`)
})

test('§2.4 gate (c-params): no non-canonical Astro.params.lang equality/coalesce in .astro', () => {
  // rg -n "Astro\.params\.lang\s*(===|\|\|)" astro/src --glob "*.astro"
  const out = runRg('Astro\\.params\\.lang\\s*(===|\\|\\|)', ['--glob', '*.astro'])
  assert.equal(out, '', `non-canonical Astro.params.lang must be gone; found:\n${out}`)
})

test('§2.4 gate (d-prefix): no hardcoded /en locale prefix in src', () => {
  // rg -n --pcre2 '/en(?:\$\{|/|["\x27\x60]|$)' astro/src --glob "*.{ts,astro,vue}"
  const out = runRg('/en(?:\\$\\{|/|["\x27`]|$)', ['--glob', '*.{ts,astro,vue}'])
  assert.equal(out, '', `hardcoded /en prefixes must be gone; found:\n${out}`)
})

test('§2.4 gate (e-toggle): no binary toggleToAr/toggleToEn keys anywhere', () => {
  // rg -n "toggleTo(Ar|En)" astro/src astro/src/i18n --glob "*.{ts,astro,vue,json}"
  const out = runRg('toggleTo(Ar|En)', ['--glob', '*.{ts,astro,vue,json}'])
  assert.equal(out, '', `binary toggle keys must be gone; found:\n${out}`)
})
