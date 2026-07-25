// In-process Payload singleton. Astro reads CMS content/tenants via the Payload Local API
// (`payload.find`) instead of HTTP, so the whole Payload config + SQLite pool live inside the
// Astro server process. The config itself is imported from the @bitrails-works/cms package
// (./config export) — this module owns only the runtime wiring + env bootstrap.
import { existsSync } from "node:fs";
import path from "node:path";
import { getPayload as createPayload } from "payload";
import type { Payload } from "payload";

const GLOBAL = globalThis as typeof globalThis & { __payloadSingleton?: Promise<Payload> };

// Astro runs Payload in-process, so it needs the SAME env the CMS uses — PAYLOAD_SECRET, the
// commerce/gateway keys, etc. — which live in cms/.env. Vite only loads .env into import.meta.env
// (NOT process.env), but Payload reads process.env. Load cms/.env here, BEFORE the config
// evaluates. process.loadEnvFile is Node ≥20.12; CWD-relative paths.
function loadCmsEnv() {
  if (typeof process.loadEnvFile !== "function") return;
  for (const candidate of ["../cms/.env", "./cms/.env", "../../cms/.env"]) {
    try {
      process.loadEnvFile(candidate);
      break;
    } catch {
      // not found at this CWD — try the next candidate
    }
  }
  // cms/.env's DATABASE_URI is `file:./cms.db`, written for CWD=cms/. The astro process runs
  // from astro/, so that path won't resolve — rebase to the sibling cms/ dir. A real env
  // override pointing at an existing file (deployment) is left untouched.
  const raw = (process.env.DATABASE_URI || "").replace(/^file:/, "");
  if (raw && !existsSync(raw)) {
    process.env.DATABASE_URI = `file:${path.resolve(process.cwd(), "../cms/cms.db")}`;
  }
}

// Config is imported dynamically AFTER loadCmsEnv so it evaluates with process.env populated
// (it reads PAYLOAD_SECRET / DATABASE_URI at module-eval time).
let _configPromise: Promise<any> | undefined;
function loadConfig() {
  if (!_configPromise) {
    loadCmsEnv();
    _configPromise = import("@bitrails-works/cms/config").then((m) => m.default);
  }
  return _configPromise;
}

// Lazy + cached on globalThis: HMR-safe (dev reloads reuse one instance, no DB-pool leak) and
// race-free (concurrent first-requests share the same init promise).
export async function getCmsPayload(): Promise<Payload> {
  if (!GLOBAL.__payloadSingleton) {
    const config = await loadConfig();
    GLOBAL.__payloadSingleton = createPayload({ config });
  }
  return GLOBAL.__payloadSingleton;
}
