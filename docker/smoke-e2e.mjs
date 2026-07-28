// End-to-end host check for the dashboard launch + proxy flow (the part the Docker image would
// prove). Starts docker/supervisor.mjs in-process against the existing cms.db, then hits
// /admin on the Astro port and asserts the middleware → supervisor ensure → CMS boot → proxy
// chain returns the Payload admin shell. Run: node docker/smoke-e2e.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ASTRO_PORT = "4421"; // avoid clashing with a dev server on 4321
const CMS_PORT = "3041";
const CONTROL_PORT = "9321";

// Load cms/.env so PAYLOAD_SECRET / DATABASE_URI are present for the children (the container
// gets these from --env-file; here we source them the same way).
function loadEnv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}
const cmsEnv = loadEnv(path.join(ROOT, "cms/.env"));

const child = spawn(process.execPath, ["docker/supervisor.mjs"], {
  cwd: ROOT,
  env: {
    ...process.env,
    ...cmsEnv,
    ASTRO_MODE: "in-process",
    ASTRO_AUTOSTART: "true",
    APP_ROOT: ROOT,
    PAYLOAD_MODE: "inactivity-timeout",
    PAYLOAD_AUTOSTART: "false",
    PAYLOAD_INACTIVITY_TIMEOUT_MS: "999999999", // don't kill mid-test
    PAYLOAD_MIGRATE_ON_BOOT: "false",            // cms.db already migrated
    ASTRO_PORT,
    CMS_PORT,
    CONTROL_PORT,
    HOST: "127.0.0.1",
    SUPERVISOR_CONTROL_URL: `http://127.0.0.1:${CONTROL_PORT}`, // astro middleware reads this
    CMS_INTERNAL_ORIGIN: `http://127.0.0.1:${CMS_PORT}`,         // middleware proxies here
    // Force the cms DB path to the existing file regardless of cms/.env's CWD-relative default.
    DATABASE_URI: `file:${path.join(ROOT, "cms/cms.db").replace(/\\/g, "/")}`,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
const logs = [];
child.stdout.on("data", (d) => logs.push(d.toString()));
child.stderr.on("data", (d) => logs.push(d.toString()));

let failures = 0;
const ok = (c, d = "") => (console.log(`${c ? "PASS" : "FAIL"}: ${d}`), c || failures++);

// Poll until `want(status, body)` passes. Always drains the body so gzipped streams aren't left
// half-read (which throws Z_DATA_ERROR on a later read).
async function wait(url, ms = 90000, want = () => true) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { redirect: "manual" });
      const body = await r.text().catch(() => "");
      if (want(r.status, body, r.headers)) return { status: r.status, body, headers: r.headers };
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

try {
  // 1. Astro home comes up (in-process Payload init takes a few seconds).
  const home = await wait(`http://127.0.0.1:${ASTRO_PORT}/`, 90000, (s) => s === 200);
  ok(!!home, "Astro home responds 200 (in-process Payload booted)");

  // 2. Before /admin, the dashboard process is NOT running.
  const status0 = await (await fetch(`http://127.0.0.1:${CONTROL_PORT}/internal/payload/status`)).json();
  ok(status0.running === false, "dashboard not running before first /admin hit");

  // 3. Hit /admin — middleware asks supervisor to ensure the CMS, which boots next start and
  //    waits for /admin to answer, then proxies. Allow up to 120s for Next + Payload cold start.
  const adminRes = await wait(
    `http://127.0.0.1:${ASTRO_PORT}/admin`,
    120000,
    // 200 = admin shell; 3xx = redirect to login — both mean the proxy reached the dashboard.
    (s) => s < 400,
  );
  ok(!!adminRes, `/admin proxied (dashboard launched on demand) — status ${adminRes?.status ?? "none"}`);
  if (adminRes) {
    ok(/payload|bitrails|<html|<!doctype|id="root"|__next/i.test(adminRes.body), "proxied body is the admin shell (HTML)");
    ok(adminRes.headers.get("content-type")?.includes("text/html"), "content-type text/html");
    console.log(`      body[0..160]: ${JSON.stringify(adminRes.body.slice(0, 160))}`);
  }

  // 4. After /admin, the dashboard process IS running.
  const status1 = await (await fetch(`http://127.0.0.1:${CONTROL_PORT}/internal/payload/status`)).json();
  ok(status1.running === true, "dashboard running after /admin hit");
} catch (e) {
  console.log("ERROR:", e);
  failures++;
} finally {
  // kill the whole group: supervisor + astro + cms
  try { child.kill("SIGTERM"); } catch {}
  setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 8000);
  await new Promise((r) => setTimeout(r, 1500));
  console.log("\n--- supervisor log tail ---");
  console.log(logs.join("").split("\n").filter(Boolean).slice(-15).join("\n"));
}

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
