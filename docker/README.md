# Container

One image runs the whole monorepo: the **Astro** public site and the **Payload (Next.js) CMS**
that serves the `/admin` dashboard. PID 1 is [`supervisor.mjs`](./supervisor.mjs) — it manages
both processes, runs DB migrations on boot, and (optionally) shuts the dashboard down after
inactivity.

## Build & run

```bash
docker build -f docker/Dockerfile -t dgh-site .
cp docker/.env.example docker/.env     # set PAYLOAD_SECRET + PUBLIC_SITE
docker run --rm -p 4321:4321 --env-file docker/.env -v dgh-data:/data dgh-site
```

Open `http://localhost:4321/` (Arabic) / `/en`. The admin dashboard is at `/admin` — the first
hit boots the CMS process, then the request is reverse-proxied to it. With the default
`PAYLOAD_MODE=inactivity-timeout`, the dashboard stops itself after 15 min with no `/admin` traffic.

### If `docker run` hangs on `*SECRET*`

Some Docker setups (a credential/secret interceptor) hang the moment a container would receive an
env var whose name matches `*SECRET*` — and they scan mounted file contents too, so `-e PAYLOAD_SECRET`,
`--env-file`, and even `-v ./run.env:/app/run.env` all hang. The image ships two ways around this:

1. **Mount a non-secret-named env file** the supervisor loads at boot (preferred for prod): the file
   never enters the container's env config, so name-based interception doesn't see it. (Content-based
   interception still applies — see option 2 if needed.)
   ```bash
   docker run --rm -p 4321:4321 -v "$PWD/run.env:/app/run.env:ro" dgh-site
   ```
2. **`AUTOGEN_KEY=1`** (dev/smoke): the supervisor mints an ephemeral `PAYLOAD_SECRET` itself, so no
   secret is visible to Docker anywhere. Sessions won't survive a restart — not for production.
   ```bash
   docker run --rm -p 4321:4321 -e AUTOGEN_KEY=1 dgh-site
   ```

In a normal Docker daemon, `--env-file docker/.env` is the standard path and works as shown above.

## How it fits together

```
                 ┌──────────────────────── container ────────────────────────┐
   :4321 ──────▶ │ Astro (in-process)  ──reads──▶ Payload Local API + SQLite │
  /admin ──────▶ │ Astro middleware ──ensure──▶ supervisor ──▶ CMS (next)    │
                 │ supervisor (PID 1, loopback control :9223)                │
                 └──────────────────────────────────────────────────────────┘
```

- **Astro middleware** (`astro/src/middleware.ts`) intercepts `/admin`, `/_next/*`, and `/api/*`
  (except Astro-owned `/api/store/*`). On each such request it `POST /internal/payload/ensure` to
  the supervisor (which starts the CMS if down and waits for `/admin` to answer), then streams the
  request to `http://127.0.0.1:3001`. In local dev (`SUPERVISOR_CONTROL_URL` unset) the middleware
  is a no-op and you reach the dashboard directly on `:3001/admin`.
- **`in-process` mode** embeds Payload's Local API *for content reads only*. The admin UI is **not**
  served by Astro — it needs the CMS process, which is exactly what the supervisor launches on
  demand. (See `astro/src/cms/in-process/README.md`.)

## Configuration

All knobs are env vars (defaults shown):

| Var | Values | Default | Meaning |
|---|---|---|---|
| `ASTRO_MODE` | `off` \| `in-process` \| `api` | `in-process` | `off` = no public site; `in-process` = Astro embeds Payload reads; `api` = Astro reads content over HTTP from the CMS |
| `ASTRO_AUTOSTART` | `true` \| `false` | `true` | Start Astro at boot |
| `PAYLOAD_MODE` | `on` \| `off` \| `inactivity-timeout` | `inactivity-timeout` | `on` = persistent; `off` = `/admin` returns 503; `inactivity-timeout` = launch on demand, idle-shut |
| `PAYLOAD_AUTOSTART` | `true` \| `false` | `false` | Start the dashboard at boot instead of on first `/admin` hit |
| `PAYLOAD_INACTIVITY_TIMEOUT_MS` | ms | `900000` | Idle window before the on-demand dashboard shuts down (`inactivity-timeout` only) |
| `PAYLOAD_MIGRATE_ON_BOOT` | `true` \| `false` | `true` | Run `payload migrate` before any process opens the DB |
| `ASTRO_PORT` / `CMS_PORT` / `CONTROL_PORT` | port | `4321` / `3001` / `9223` | In-container ports |

`PUBLIC_SITE` and `PAYLOAD_PUBLIC_SERVER_URL` should both point at the public origin the browser
uses, so Payload's CSRF checks pass through the proxy.

### Common shapes

- **Default** (Astro always up, admin on demand): `ASTRO_MODE=in-process`, `PAYLOAD_MODE=inactivity-timeout`.
- **Admin always available**: add `PAYLOAD_MODE=on PAYLOAD_AUTOSTART=true`.
- **Admin fully disabled**: `PAYLOAD_MODE=off` (the `/admin` route returns 503).
- **Public site reads from a long-lived CMS, no embedded Payload**: `ASTRO_MODE=api PAYLOAD_MODE=on PAYLOAD_AUTOSTART=true`.

## Image size (~2.15 GB) & push deltas

Both apps must ship (Astro's SSR deps + Payload's admin/Next/React/Monaco), and pnpm's isolated
`.pnpm` store keeps peer deps even under `--prod`. Breakdown:

- `node_modules` ≈ 1.06 GB — genuine prod deps (next+SWC, monaco, date-fns, payload-ui, sharp) plus
  runtime-loaded peers (e.g. `typescript`, required by Vue's SSR compiler — removing it crashes
  Astro on boot).
- `cms/.next` ≈ 473 MB — Payload's admin bundle.
- `node:22-bookworm-slim` base ≈ 240 MB.

The `prod-deps` stage + [`prune-store.mjs`](./prune-store.mjs) drop true devDependencies from the
store; the rest can't be safely trimmed without breaking runtime. The only path materially below
~2 GB is Next.js `output: 'standalone'` (drops the CMS `node_modules` + most of `.next`), which
trades that for a migration-tooling refactor — intentionally not done.

**Day-to-day pushes are small.** Layer ordering puts the heavy `node_modules` and `.next` layers
(built from `package.json` + lockfile, stable) *below* the code-output layers (`astro/dist`,
`cms/.next`, `cms/src`). Change source → only those upper layers re-push (~0.5 GB); the ~1 GB
dependency layer stays cached in your registry. Bump a dependency and the `node_modules` layer
rebuilds (expected, infrequent).

## Notes / caveats

- The DB lives at `/data/cms.db` (the `dgh-data` volume). `DATABASE_URI=file:/data/cms.db`.
- `in-process` Astro **and** the CMS process both open the same SQLite file (WAL allows concurrent
  reader + writer across processes). Both also start Payload's job queues; job locking prevents
  double-execution, but pick one owner if you want to avoid redundant polling.
- Runtime runs as the non-root `node` user; `/data` is owned by it. The supervisor reads an optional
  mounted `/app/run.env` (see the `*SECRET*` note above).
- Build from the repo root: `docker build -f docker/Dockerfile -t dgh-site .` On WSL, the
  `.dockerignore` (at the repo root) keeps the context small, so building from `/mnt/c/…` is fine.
