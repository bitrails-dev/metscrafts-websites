// Locale invariant sweep (§2.4 of docs/superpowers/plans/2026-07-27-per-tenant-languages.md).
// Recursively scans astro/src/**/*.{ts,astro,vue} plus astro/astro.config.mjs and fails with
// `file:line:reason:text` for: (a) quoted catalogue codes outside src/i18n/index.ts; (b) non-canonical
// Astro.params.lang usage; (c) hardcoded prefixed-locale path construction; (d) legacy toggleToAr/En
// keys; (e) identifiers ending in `Ar` (except the pinned external-portal `fullNameAr`). The quoted-code
// and prefix alternations are derived from `LOCALES`/`UNPREFIXED_LOCALE`, so adding a locale never
// requires editing this script.
import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LOCALES, UNPREFIXED_LOCALE } from "../src/i18n/index";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const src = resolve(root, "src");
const canonical = resolve(src, "i18n/index.ts");
const portalSignUp = resolve(src, "components/portal/PortalSignUp.vue");
const extensions = new Set([".ts", ".astro", ".vue"]);
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const localeAlternation = LOCALES.map(escape).join("|");
const prefixedAlternation = LOCALES.filter((locale) => locale !== UNPREFIXED_LOCALE).map(escape).join("|");

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return extensions.has(entry.name.slice(entry.name.lastIndexOf("."))) ? [path] : [];
  }));
  return nested.flat();
}

const files = [...await walk(src), resolve(root, "astro.config.mjs")];
const findings: string[] = [];
for (const file of files) {
  const original = await readFile(file, "utf8");
  const text = original
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .replace(/\/\/.*$/gm, "");
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    const errors: string[] = [];
    if (file !== canonical && new RegExp(`(["'])(?:${localeAlternation})\\1`).test(line)) errors.push("raw locale literal");
    if (/Astro\.params\.lang/.test(line) && !/toLang\(Astro\.params\.lang,/.test(line)) errors.push("non-canonical Astro.params.lang");
    if (prefixedAlternation && new RegExp(`/(?:${prefixedAlternation})(?:/|\\$\\{|["'\x60]|$)`).test(line)) errors.push("manual locale prefix");
    if (/toggleTo(?:Ar|En)\b/.test(line)) errors.push("binary toggle key");
    const arIdentifiers = line.match(/\b[A-Za-z][A-Za-z0-9]*Ar\b/g) ?? [];
    const forbiddenArIdentifiers = arIdentifiers.filter((name) => !(file === portalSignUp && name === "fullNameAr"));
    if (forbiddenArIdentifiers.length) errors.push(`legacy Ar identifier: ${forbiddenArIdentifiers.join(",")}`);
    if (errors.length) findings.push(`${relative(root, file)}:${index + 1}:${errors.join("; ")}:${original.split(/\r?\n/)[index]?.trim()}`);
  });
}
if (findings.length) {
  console.error(findings.join("\n"));
  process.exitCode = 1;
}
