#!/usr/bin/env node
// Container PID 1. Owns the lifecycle of the Astro public site and the Payload (Next.js) CMS
// "dashboard" process. The Astro middleware asks this supervisor to ensure the dashboard is up
// before reverse-proxying /admin to it, and to enforce the inactivity shutdown.
//
// Config (env, see docker/.env.example):
//   ASTRO_MODE                  off | in-process | api          (default in-process)
//   ASTRO_AUTOSTART             true | false                    (default true)
//   PAYLOAD_MODE                on | off | inactivity-timeout   (default inactivity-timeout)
//   PAYLOAD_AUTOSTART           true | false                    (default false → launch on first /admin hit)
//   PAYLOAD_INACTIVITY_TIMEOUT_MS                                (default 900000 = 15 min)
//   PAYLOAD_MIGRATE_ON_BOOT     true | false                    (default true)
//   ASTRO_PORT / CMS_PORT / CONTROL_PORT                        (4321 / 3001 / 9223)
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import path from "node:path";

// Load an optional mounted env file (e.g. `docker run -v ./run.env:/app/run.env:ro`) BEFORE
// anything reads process.env. This lets secrets like PAYLOAD_SECRET reach the children WITHOUT
// passing them via `docker run -e`/`--env-file` — some Docker setups intercept/hang on env vars
// whose name matches *SECRET*, but a bind-mounted file never enters the container env config.
const ENV_FILE = process.env.SUPERVISOR_ENV_FILE ?? "/app/run.env";
try {
  if (typeof process.loadEnvFile === "function") process.loadEnvFile(ENV_FILE);
} catch {
  /* no mounted env file — env comes from the real process environment */
}

// Opt-in ephemeral secret for dev/smoke where PAYLOAD_SECRET can't be passed to docker (env-name
// interception). Name avoids *SECRET* so the same interception doesn't gate it. PRODUCTION MUST
// set a stable PAYLOAD_SECRET — this is a development convenience, off by default.
if (
  !process.env.PAYLOAD_SECRET &&
  (process.env.AUTOGEN_KEY === "1" || process.env.AUTOGEN_KEY === "true")
) {
  process.env.PAYLOAD_SECRET = randomBytes(32).toString("hex");
  console.log(
    "[supervisor] WARNING: generated ephemeral PAYLOAD_SECRET (AUTOGEN_KEY=1). " +
      "Sessions/signed tokens will NOT survive a restart — set PAYLOAD_SECRET in production.",
  );
}

// `/app` in the container; override with APP_ROOT to run the supervisor on the host (tests).
const ROOT = process.env.APP_ROOT ?? "/app";
const ASTRO_DIR = path.join(ROOT, "astro");
const CMS_DIR = path.join(ROOT, "cms");
const TRUE = (v) => v === "1" || v === "true";
const log = (...a) => console.log("[supervisor]", ...a);

const CFG = {
  astroMode: (process.env.ASTRO_MODE ?? "in-process").toLowerCase(),
  astroAutostart: TRUE(process.env.ASTRO_AUTOSTART ?? "true"),
  payloadMode: (process.env.PAYLOAD_MODE ?? "inactivity-timeout").toLowerCase(),
  payloadAutostart: TRUE(process.env.PAYLOAD_AUTOSTART ?? "false"),
  idleMs: parseInt(process.env.PAYLOAD_INACTIVITY_TIMEOUT_MS ?? "900000", 10),
  astroPort: parseInt(process.env.ASTRO_PORT ?? process.env.PORT ?? "4321", 10),
  cmsPort: parseInt(process.env.CMS_PORT ?? "3001", 10),
  controlPort: parseInt(process.env.CONTROL_PORT ?? "9223", 10),
  migrateOnBoot: TRUE(process.env.PAYLOAD_MIGRATE_ON_BOOT ?? "true"),
  seedOnBoot: TRUE(process.env.PAYLOAD_SEED_ON_BOOT ?? "true"),
};

let astro = null;
let cms = null;
let migrateRan = false;
let lastActivity = Date.now();
let ensureInFlight = null;

const cmsOrigin = () => `http://127.0.0.1:${CFG.cmsPort}`;

function cmsEnv() {
  const env = { ...process.env };
  env.PORT = String(CFG.cmsPort);
  env.PAYLOAD_PUBLIC_SERVER_URL =
    process.env.PAYLOAD_PUBLIC_SERVER_URL ?? cmsOrigin();
  return env;
}

function startAstro() {
  if (astro || CFG.astroMode === "off") return;
  const env = { ...process.env, PORT: String(CFG.astroPort), HOST: "0.0.0.0" };
  // in-process = Astro embeds Payload Local API for reads (CMS_MODE=in-process).
  // api        = Astro reads content over HTTP from the CMS process.
  env.CMS_MODE = CFG.astroMode === "api" ? "api" : "in-process";
  astro = spawn("node", ["dist/server/entry.mjs"], {
    cwd: ASTRO_DIR,
    env,
    stdio: "inherit",
  });
  astro.on("error", (e) => log("astro spawn error:", e.message));
  astro.on("exit", (code, sig) => {
    log(`astro exited (${code}/${sig})`);
    astro = null;
  });
}

async function runMigrations() {
  if (migrateRan) return;
  migrateRan = true;
  if (!CFG.migrateOnBoot) return; // flag gates ALL auto-migrate paths (boot + on-demand ensure)
  await new Promise((resolve) => {
    log("running payload migrate");
    // node_modules/payload/bin.js is the CLI entry (real JS, portable — the .bin shim isn't).
    const p = spawn("node", ["node_modules/payload/bin.js", "migrate"], {
      cwd: CMS_DIR,
      env: cmsEnv(),
      stdio: "inherit",
    });
    p.on("error", (e) => log("payload migrate spawn error:", e.message));
    p.on("exit", (code) => {
      log(`payload migrate exit ${code}`);
      resolve();
    });
  });
}

// Seed the default tenant on a fresh DB so create-first-user can satisfy the multi-tenant
// `tenants` field. Idempotent (the script no-ops if the tenant exists). Runs after migrate.
let seedRan = false;
async function runSeed() {
  if (seedRan) return;
  seedRan = true;
  if (!CFG.seedOnBoot) return;
  await new Promise((resolve) => {
    log("running seed-tenants (idempotent)");
    const p = spawn("node", ["node_modules/tsx/dist/cli.mjs", "scripts/seed-tenants.ts"], {
      cwd: CMS_DIR,
      env: cmsEnv(),
      stdio: "inherit",
    });
    p.on("error", (e) => log("seed-tenants spawn error:", e.message));
    p.on("exit", (code) => {
      log(`seed-tenants exit ${code}`);
      resolve();
    });
  });
}

function startCms() {
  if (cms || CFG.payloadMode === "off") return;
  log("starting cms (Payload dashboard)");
  // node_modules/next/dist/bin/next is the real CLI entry (portable across Linux/Windows).
  cms = spawn(
    "node",
    ["node_modules/next/dist/bin/next", "start", "-p", String(CFG.cmsPort), "-H", "127.0.0.1"],
    { cwd: CMS_DIR, env: cmsEnv(), stdio: "inherit" },
  );
  cms.on("error", (e) => log("cms spawn error:", e.message));
  cms.on("exit", (code, sig) => {
    log(`cms exited (${code}/${sig})`);
    cms = null;
  });
  lastActivity = Date.now();
}

function stopCms() {
  if (!cms) return;
  log("stopping cms (inactivity or shutdown)");
  const c = cms;
  cms = null;
  c.kill("SIGTERM");
  setTimeout(() => {
    try {
      c.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }, 10000).unref();
}

async function waitForCms(timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${cmsOrigin()}/admin`, { redirect: "manual" });
      if (r.status < 500) return true;
    } catch {
      /* still booting */
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  return false;
}

// Idempotent: start the dashboard if needed, wait until it answers, reset the idle timer.
async function ensureCms() {
  if (CFG.payloadMode === "off") {
    return { ok: false, status: 503, error: "payload disabled (PAYLOAD_MODE=off)" };
  }
  lastActivity = Date.now();
  if (cms) return { ok: true, origin: cmsOrigin() };
  if (ensureInFlight) return ensureInFlight;
  ensureInFlight = (async () => {
    await runMigrations();
    startCms();
    const up = await waitForCms();
    return up
      ? { ok: true, origin: cmsOrigin() }
      : { ok: false, status: 502, error: "cms failed health check" };
  })();
  try {
    return await ensureInFlight;
  } finally {
    ensureInFlight = null;
  }
}

// Loopback control API — used by the Astro middleware. Never bind this to 0.0.0.0.
const ctl = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  if (pathname === "/internal/payload/ensure" && req.method === "POST") {
    const r = await ensureCms();
    res.writeHead(r.status ?? 200, { "content-type": "application/json" });
    res.end(JSON.stringify(r));
  } else if (pathname === "/internal/payload/status" && req.method === "GET") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        running: !!cms,
        payloadMode: CFG.payloadMode,
        astroMode: CFG.astroMode,
        lastActivity,
      }),
    );
  } else if (pathname === "/internal/health" && req.method === "GET") {
    res.writeHead(astro || CFG.astroMode === "off" ? 200 : 503);
    res.end();
  } else {
    res.writeHead(404);
    res.end();
  }
});
ctl.listen(CFG.controlPort, "127.0.0.1", () =>
  log(`control api on 127.0.0.1:${CFG.controlPort}`),
);

// Inactivity timer: only active in inactivity-timeout mode. Tick at ≈¼ of the window (capped to
// 1 min) so shutdown follows the threshold promptly instead of up to a full window late.
if (CFG.payloadMode === "inactivity-timeout" && CFG.idleMs > 0) {
  const tick = Math.min(60000, Math.max(1000, Math.floor(CFG.idleMs / 4)));
  setInterval(() => {
    if (cms && Date.now() - lastActivity > CFG.idleMs) {
      log(`inactivity (${CFG.idleMs}ms) reached — stopping cms`);
      stopCms();
    }
  }, tick).unref();
}

async function boot() {
  // ponytail: migrate whenever any process will open the DB (in-process Astro, or the CMS at all).
  const needsDb =
    CFG.astroMode === "in-process" || CFG.payloadMode !== "off";
  if (CFG.migrateOnBoot && needsDb) await runMigrations();
  if (CFG.seedOnBoot && needsDb) await runSeed();

  if (CFG.payloadMode !== "off" && CFG.payloadAutostart) {
    startCms();
    await waitForCms();
  }
  if (CFG.astroMode !== "off" && CFG.astroAutostart) startAstro();

  log(
    `boot complete — astro=${CFG.astroMode}@${CFG.astroPort}` +
      ` payload=${CFG.payloadMode}` +
      (CFG.payloadMode === "inactivity-timeout" ? ` (idle ${CFG.idleMs}ms)` : ""),
  );
}

function shutdown() {
  log("shutdown signal received");
  if (cms) cms.kill("SIGTERM");
  if (astro) astro.kill("SIGTERM");
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

boot();
