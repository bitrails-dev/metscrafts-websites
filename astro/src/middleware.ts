import { defineMiddleware } from "astro:middleware";
import { resolveTenant, routeGated } from "./lib/tenant";
import { getHealthcareSettings } from "./cms";
import {
  FEATURE_ROUTES,
  computeLocaleRedirect,
  hasUnknownLocalePrefix,
} from "./lib/feature-routes";
import type { Locale } from "./i18n";

// Re-exported for type-only consumers and future tooling. Pure helpers live in
// `./lib/feature-routes` (no `astro:middleware` dep) so they remain importable under
// `tsx --test` (which can't resolve Astro virtual modules).
export { buildFeatureRoutes, isContentPath, FEATURE_ROUTES } from "./lib/feature-routes";

// --- Payload dashboard on-demand proxy (container only) ---
// When SUPERVISOR_CONTROL_URL is set, requests for the Payload admin / Next assets / CMS REST are
// reverse-proxied to the in-container CMS process, which the supervisor launches on first hit and
// may idle-shut. `/api/store/*` is Astro's own storefront BFF and is NEVER proxied. Unset (local
// dev, no supervisor) → this block is skipped and the dashboard is reached directly on :3001.
const SUPERVISOR = process.env.SUPERVISOR_CONTROL_URL;
const PAYLOAD_MODE = (process.env.PAYLOAD_MODE ?? "on").toLowerCase();
const CMS_ORIGIN = process.env.CMS_INTERNAL_ORIGIN ?? "http://127.0.0.1:3001";

function isDashboardPath(p: string): boolean {
  if (p === "/admin" || p.startsWith("/admin/")) return true;
  if (p.startsWith("/_next/")) return true;
  if (p === "/api" || p.startsWith("/api/")) {
    // Astro owns /api/store/* (signed BFF); everything else under /api is Payload REST → proxy.
    return !(p === "/api/store" || p.startsWith("/api/store/"));
  }
  return false;
}

// Hop-by-hop / host headers that must not be forwarded across the proxy boundary. content-encoding
// + content-length are stripped on the RESPONSE path too: undici decompresses upstream gzip, so the
// body we forward is already decoded — re-advertising the encoding would make the client gunzip
// plain bytes. (See stripHeaders below.)
const HOP = new Set([
  "connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade",
  "host", "content-length", "content-encoding",
]);

async function proxyToDashboard(context: Parameters<Parameters<typeof defineMiddleware>[0]>[0]) {
  if (PAYLOAD_MODE === "off") {
    return new Response("Payload dashboard disabled (PAYLOAD_MODE=off).", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  // Ask the supervisor to ensure the CMS is up (starts it if down, waits for /admin to answer,
  // and resets the inactivity timer). Idempotent.
  let ensure: Response;
  try {
    ensure = await fetch(`${SUPERVISOR}/internal/payload/ensure`, { method: "POST" });
  } catch {
    return new Response("Supervisor unreachable.", { status: 502 });
  }
  if (!ensure.ok) {
    return new Response("Payload dashboard not available.", { status: 502 });
  }

  const upstream = new URL(context.url.pathname + context.url.search, CMS_ORIGIN);
  const headers = new Headers();
  context.request.headers.forEach((v, k) => {
    if (!HOP.has(k.toLowerCase())) headers.set(k, v);
  });
  // Full host:port + scheme so the CMS (Next.js) reconstructs the same origin the browser used —
  // Next Server Actions reject requests whose x-forwarded-host != origin host (e.g. localhost vs
  // localhost:4321). Keep multi-valued headers (a request may carry several x-forwarded-* entries).
  const xfHost = context.request.headers.get("x-forwarded-host");
  const hostVal = context.url.host; // hostname:port as the browser sees it
  headers.set("x-forwarded-host", xfHost ? `${xfHost}, ${hostVal}` : hostVal);
  headers.set("x-forwarded-proto", context.url.protocol.replace(":", ""));
  const init: RequestInit & { duplex?: "half" } = { method: context.request.method, headers };
  if (!["GET", "HEAD"].includes(context.request.method)) {
    init.body = context.request.body as any;
    init.duplex = "half"; // streaming request body (Node ≥18)
  }

  let resp: Response;
  try {
    resp = await fetch(upstream, init);
  } catch {
    return new Response("Bad gateway to CMS.", { status: 502 });
  }
  const out = new Headers();
  resp.headers.forEach((v, k) => {
    if (!HOP.has(k.toLowerCase())) out.set(k, v);
  });
  return new Response(resp.body, { status: resp.status, headers: out });
}

// Resolve the tenant once per request from the host (or TENANT_SLUG), expose it on
// Astro.locals.tenant, and gate feature routes. Pages/components read locals.tenant to filter
// content and hide nav/sections.
export const onRequest = defineMiddleware(async (context, next) => {
  // Dashboard traffic bypasses tenant gating (Payload auth owns /admin). Mounted only when a
  // supervisor is present — keeps local dev unchanged.
  if (SUPERVISOR && isDashboardPath(context.url.pathname)) {
    return proxyToDashboard(context);
  }
  const tenant = await resolveTenant(context.url.hostname);
  context.locals.tenant = tenant;

  // Path used by both locale enforcement and feature gating. Hoisted above the locale
  // block (RC-2/TS2448) — the old lower declaration was removed when this block was inserted.
  const path = context.url.pathname;

  // `[...lang]` accepts arbitrary multi-segment values. Fail closed for locale-shaped prefixes
  // outside the platform catalogue so they cannot become duplicate localized pages.
  if (hasUnknownLocalePrefix(path)) {
    return new Response("Not Found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  // Locale enforcement — runs IMMEDIATELY AFTER the tenant assign and BEFORE the
  // vertical-settings healthcare-settings fetch + the feature gate (do NOT reorder the
  // healthcare block below). When the tenant publishes a non-empty language set, any
  // content path whose requested locale is outside that set 302-redirects to the tenant
  // default locale. The querystring is preserved verbatim (BLK-4). Pure decision logic
  // lives in `computeLocaleRedirect` so it is unit-testable under tsx.
  if (tenant?.languages?.length) {
    const dest = computeLocaleRedirect(
      path,
      context.url.search,
      tenant.languages as readonly Locale[],
      (tenant.defaultLanguage ?? tenant.languages[0]) as Locale,
    );
    if (dest) return context.redirect(dest, 302);
  }

  // Single per-request healthcare-settings read. Only healthcare tenants carry hero stats / an
  // emergency number to surface, and the UNIQUE(tenant_id) invariant makes this one indexed lookup.
  // Dashboard-proxy requests return above before reaching here, so they bypass this read entirely.
  if (tenant && tenant.features.includes("healthcare")) {
    try {
      const settings = await getHealthcareSettings(tenant.id);
      context.locals.healthcareSettings = settings;
      if (!settings) {
        console.warn(`[middleware] no healthcare-settings document for tenant "${tenant.slug}"`);
      }
    } catch (e) {
      console.warn(`[middleware] healthcare-settings read failed for tenant "${tenant.slug}": ${e}`);
    }
  }

  const rule = FEATURE_ROUTES.find(([re]) => re.test(path));
  if (rule && routeGated(tenant, rule[1])) {
    return context.rewrite("/404");
  }

  return next();
});
