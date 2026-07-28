// Validates the inactivity-timeout shutdown: boots the supervisor with a short idle window and
// PAYLOAD_AUTOSTART=true, confirms the dashboard starts, then that it stops itself after the idle
// window passes with no traffic. Run: node docker/smoke-idle.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const IDLE_MS = "6000";
const CMS_PORT = "3051";
const CONTROL_PORT = "9351";

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
    ...process.env, ...cmsEnv,
    APP_ROOT: ROOT,
    ASTRO_MODE: "off",
    ASTRO_AUTOSTART: "false",
    PAYLOAD_MODE: "inactivity-timeout",
    PAYLOAD_AUTOSTART: "true",
    PAYLOAD_INACTIVITY_TIMEOUT_MS: IDLE_MS,
    PAYLOAD_MIGRATE_ON_BOOT: "false",
    CMS_PORT, CONTROL_PORT,
    DATABASE_URI: `file:${path.join(ROOT, "cms/cms.db").replace(/\\/g, "/")}`,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
const logs = [];
child.stdout.on("data", (d) => logs.push(d.toString()));
child.stderr.on("data", (d) => logs.push(d.toString()));

let failures = 0;
const ok = (c, d = "") => (console.log(`${c ? "PASS" : "FAIL"}: ${d}`), c || failures++);
const status = async () => (await (await fetch(`http://127.0.0.1:${CONTROL_PORT}/internal/payload/status`)).json());

try {
  // dashboard autostarts at boot; wait until running
  let s = null;
  for (let i = 0; i < 60; i++) {
    s = await status().catch(() => null);
    if (s?.running) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  ok(!!s?.running, "dashboard autostarted at boot");

  // no traffic for idleMs + grace
  const wait = parseInt(IDLE_MS, 10) + 5000;
  await new Promise((r) => setTimeout(r, wait));
  const s2 = await status();
  ok(s2?.running === false, `dashboard idle-shut after ${wait}ms with no traffic (running=${s2?.running})`);
} catch (e) {
  console.log("ERROR:", e);
  failures++;
} finally {
  try { child.kill("SIGTERM"); } catch {}
  await new Promise((r) => setTimeout(r, 1200));
  console.log("\n--- supervisor log tail ---");
  console.log(logs.join("").split("\n").filter(Boolean).slice(-8).join("\n"));
}
console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
