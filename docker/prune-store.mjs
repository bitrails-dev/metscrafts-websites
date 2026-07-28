// Removes unreferenced packages from pnpm's project-local .pnpm store.
// pnpm's isolated linker retains devDependencies in the store even after `pnpm install --prod`
// (--prod only filters linking, not store contents), so the devDeps would still ship. After a
// --prod install they are unreferenced; this resolves the symlink graph from each package's
// node_modules (fixpoint over transitive/peer deps inside .pnpm) and deletes the unreachable set.
//
// Symlinks inside .pnpm are RELATIVE (e.g. ../../@scope+pkg@x/node_modules/...), so we resolve
// them with realpath and test absolute membership under the store — not string-match ".pnpm/".
//
// Usage: node prune-store.mjs [root]   (root defaults to /app)
import { readdirSync, readlinkSync, realpathSync, rmSync, existsSync, lstatSync } from "node:fs";
import { join, sep } from "node:path";

const root = process.argv[2] || "/app";
const nmRoots = ["node_modules", "astro/node_modules", "cms/node_modules"].map((p) => join(root, p));
const store = join(root, "node_modules", ".pnpm");
if (!existsSync(store)) {
  console.log("[prune-store] no .pnpm store found — nothing to do");
  process.exit(0);
}
const storePrefix = store + sep;

const allStorePkgs = readdirSync(store, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);
const storeSet = new Set(allStorePkgs);

// Resolve a symlink to the .pnpm package dir it points at, or null if it doesn't point into the store.
function storeTarget(linkPath) {
  let real;
  try { real = realpathSync(linkPath); } catch { return null; }
  if (!real.startsWith(storePrefix)) return null;
  return real.slice(storePrefix.length).split(sep)[0];
}

// Compute each store package's own store-deps ONCE (walk its node_modules symlinks). Memoized so
// the fixpoint below is pure set arithmetic instead of re-walking the tree every pass.
const depsOf = new Map();
function computeDeps(pkg) {
  const out = new Set();
  const nmDir = join(store, pkg, "node_modules");
  const walk = (dir) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      let st;
      try { st = lstatSync(p); } catch { continue; }
      if (st.isSymbolicLink()) {
        const t = storeTarget(p);
        if (t && storeSet.has(t)) out.add(t);
      } else if (st.isDirectory()) {
        walk(p); // scoped @scope/ dirs
      }
    }
  };
  walk(nmDir);
  return out;
}
for (const pkg of allStorePkgs) depsOf.set(pkg, computeDeps(pkg));

// 1. Seed: packages referenced by symlinks in the workspace package node_modules.
const referenced = new Set();
function collectFrom(dir) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (dir === join(root, "node_modules") && e.name === ".pnpm") continue; // store itself
    const p = join(dir, e.name);
    let st;
    try { st = lstatSync(p); } catch { continue; }
    if (st.isSymbolicLink()) {
      const t = storeTarget(p);
      if (t && storeSet.has(t)) referenced.add(t);
    } else if (st.isDirectory()) {
      collectFrom(p);
    }
  }
}
for (const d of nmRoots) collectFrom(d);

// 2. Fixpoint over the precomputed dep map: pull in transitive/peer deps.
let changed = true;
let passes = 0;
while (changed) {
  changed = false;
  for (const pkg of [...referenced]) {
    for (const dep of depsOf.get(pkg) || []) {
      if (!referenced.has(dep)) { referenced.add(dep); changed = true; }
    }
  }
  passes++;
}

// 3. Delete unreferenced store packages.
let removed = 0;
for (const pkg of allStorePkgs) {
  if (!referenced.has(pkg)) {
    rmSync(join(store, pkg), { recursive: true, force: true });
    removed++;
  }
}
console.log(
  `[prune-store] ${passes} passes: kept ${allStorePkgs.length - removed}, removed ${removed} ` +
    `(${allStorePkgs.length} total in store)`,
);
