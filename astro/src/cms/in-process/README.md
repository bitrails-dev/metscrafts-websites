# In-process CMS (Payload Local API)

This backend reads CMS content and tenants through Payload's **Local API** (`payload.find`)
inside the Astro server process itself — no HTTP roundtrip to a separate CMS server. The Payload
config + SQLite connection live in-process. It is one of two interchangeable backends behind
`../index.ts`; the other is `../api/` (REST to the CMS server). Switch with the `CMS_MODE` env var.

```
CMS_MODE=in-process   # default — what this folder implements
CMS_MODE=api          # fall back to REST fetch against CMS_URL
```

## How it works

- `payload.ts` — lazily builds one `Payload` instance (`getPayload({ config })`), cached on
  `globalThis` (HMR-safe, race-free). Loads `cms/.env` into `process.env` first (Vite only puts
  `.env` into `import.meta.env`, but Payload reads `process.env`), and rebases `DATABASE_URI` to
  the sibling `cms/cms.db` when the CWD-relative default doesn't resolve.
- `upload-url.ts` — rewrites `/api/<slug>/file/<filename>` to Astro-served `/uploads/…` (media
  flat, icons under `icons/`). The bytes live in `astro/public/uploads/`, which Astro serves
  statically, so images are self-contained too.
- `index.ts` — implements the `CmsBackend` interface: `getCollection` + `getTenants` via
  `payload.find`, `imageUrl` via the rewriter. Multi-tenant reads pass an explicit
  `where[tenant][equals]` (the plugin does not auto-filter on the Local API).

## Pros

- **No second runtime to keep alive.** Content/tenants render even if the CMS server is down.
  One process to deploy, monitor, and scale.
- **Latency.** Reads are an in-process SQLite query, not an HTTP hop. No serialization, no
  connection pool to the CMS, no `fetch` overhead per page.
- **Single DB writer.** With only the Astro process writing, SQLite's single-writer model is
  clean (no cross-process `SQLITE_BUSY` contention beyond Astro's own concurrency).
- **Self-contained images.** Upload URLs resolve to Astro's own `/uploads/…`, so media doesn't
  depend on the CMS server either.
- **Same code path in dev and prod.** No "works on my machine because the CMS was running" gap.

## Cons / tradeoffs

- **Heavier Astro process.** Payload init (plugins, jobs runner, SQLite pool) loads into the web
  server. Cold start is slower; memory footprint is larger. The full Payload config is bundled
  into the SSR output (see `vite.ssr.noExternal` in `astro.config.mjs`).
- **Coupling.** A Payload config change can break the Astro build, not just the CMS. Schema
  migrations must be applied to the DB Astro reads before deploying Astro.
- **No admin panel from this process.** Payload's admin UI is a Next.js app (`@payloadcms/next`)
  and is **not** served here. Editing content still needs the CMS runtime running (for `/admin`).
  This backend is for *delivery*, not authoring.
- **Env must be present at boot.** `PAYLOAD_SECRET` (≥32 chars) and a resolvable `DATABASE_URI`
  are required, or Payload refuses to init ("missing secret key"). Locally these come from
  `cms/.env` via `loadCmsEnv`; in production set them in the real environment.
- **Native deps.** The SQLite adapter needs `@libsql/client` (and its platform native binding) as
  a *direct* Astro dependency, or Vite bundles it and the `.node` binding can't resolve. Already
  declared in `astro/package.json`.
- **Jobs (`autoRun`).** The config starts the social-publish + commerce task queues on init. If
  the CMS runtime *also* runs them, both poll (job locking prevents double-execution, but it's
  redundant). Pick one owner and disable `autoRun` on the other.

## What does NOT move in-process (stays on the CMS runtime)

The audit (`docs/...`) found that commerce **writes** are not safe to migrate:

- `checkout` / payment confirmation (Paymob/Kashier orchestration, idempotency keys, order
  creation), customer `auth/login` / `register` / `reset-password` (session issuance), and
  `cart` mutations (the commerce plugin owns cart identity).
- These are commerce-plugin REST handlers with HMAC-signed gateway verification, pricing-engine
  calls, and payment side-effects — not plain collection CRUD. Re-implementing them outside the
  plugin is the riskiest piece and is intentionally left on HTTP (`lib/store/server.ts`).

Pure commerce **reads** (products, `auth/me`, cart GET, quote preview, orders) *could* be moved
to `payload.find` (e.g. `collection: 'store-products'`), but they currently flow through the same
signed BFF as the writes; migrate them only if you want the shop self-contained for reads too.

## When to use which mode

| | `in-process` (default) | `api` |
|---|---|---|
| CMS server required at runtime | No (delivery) / Yes (admin) | Yes |
| Read latency | In-process query | HTTP hop |
| Deploy footprint | One process | Two processes |
| Admin UI | From the CMS runtime | From the CMS runtime |
| Commerce checkout/auth | Still needs the CMS runtime | From the CMS runtime |
| Use when | You want self-contained delivery, single process, lowest read latency | The CMS is already up, you want process isolation, or a safe fallback |

**Recommendation:** ship `in-process` for delivery; keep the CMS runtime running for `/admin`,
payment webhooks, social OAuth, and commerce writes. Flip `CMS_MODE=api` to fall back to the
external CMS without code changes (useful for diagnosis or staged rollouts).
