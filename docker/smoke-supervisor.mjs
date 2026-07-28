// Smoke test for docker/supervisor.mjs: boots it with no-op modes (no real child processes),
// exercises the loopback control API, and exits. Run: node docker/smoke-supervisor.mjs
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = "9911";

const child = spawn(process.execPath, ["docker/supervisor.mjs"], {
  cwd: ROOT,
  env: {
    ...process.env,
    ASTRO_MODE: "off",
    ASTRO_AUTOSTART: "false",
    PAYLOAD_MODE: "off",
    PAYLOAD_AUTOSTART: "false",
    PAYLOAD_MIGRATE_ON_BOOT: "false",
    CONTROL_PORT: PORT,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
const logs = [];
child.stdout.on("data", (d) => logs.push(d.toString()));
child.stderr.on("data", (d) => logs.push(d.toString()));

const base = `http://127.0.0.1:${PORT}`;
let failures = 0;
function check(name, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failures++;
}

async function get(path, init) {
  const r = await fetch(base + path, init);
  return { status: r.status, body: await r.text() };
}

// wait for control API to come up
async function waitForBoot(ms = 5000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      await get("/internal/health");
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  return false;
}

try {
  const booted = await waitForBoot();
  check("control API boots and answers", booted);

  const health = await get("/internal/health");
  // ASTRO_MODE=off → supervisor reports healthy even with no astro process.
  check("/internal/health == 200 (astro off)", health.status === 200, `got ${health.status}`);

  const status = await get("/internal/payload/status");
  check("/internal/payload/status == 200", status.status === 200);
  const sj = JSON.parse(status.body);
  check("status reports payloadMode=off", sj.payloadMode === "off", sj.payloadMode);
  check("status reports astroMode=off", sj.astroMode === "off", sj.astroMode);
  check("status reports running=false (nothing started)", sj.running === false);

  const ensure = await get("/internal/payload/ensure", { method: "POST" });
  check("ensure returns 503 when PAYLOAD_MODE=off", ensure.status === 503, `got ${ensure.status}`);
} catch (e) {
  console.log("ERROR during smoke test:", e);
  failures++;
} finally {
  child.kill("SIGTERM");
  // give it a moment to log shutdown, then print tail
  await new Promise((r) => setTimeout(r, 300));
  console.log("\n--- supervisor log tail ---");
  console.log(logs.join("").split("\n").filter(Boolean).slice(-8).join("\n"));
}

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
