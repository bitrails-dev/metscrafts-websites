// Per-request tenant resolution. The site is multi-tenant: one deployment serves many
// hospitals/clinics, resolved by request host (or the TENANT_SLUG env override for a
// single-tenant deploy / dev). Content is then filtered by tenant.id and the public surface
// (nav, sections, routes) is gated by tenant.features. See src/middleware.ts for the wiring.
//
// Tenant data + logo URL come from the switchable CMS access layer (../cms): in-process reads
// tenants via the Payload Local API and rewrites the logo to /uploads/…; api mode hits the CMS
// REST endpoint and points the logo at the CMS origin.
import { getTenants, imageUrl } from "../cms";
import type { HealthcareSettings } from "../cms/shared/healthcare-settings";
import {
  toLocalizedMap,
  pickLocalized,
  LOCALES,
  FALLBACK_LANGUAGES,
  type Locale,
} from "../i18n";

export type TenantFeature =
  | "departments" | "team" | "articles" | "events"
  | "awards" | "achievements" | "testimonials" | "portal"
  | "commerce" | "healthcare";

export interface Tenant {
  id: number | string;
  slug: string;
  type: string;
  name: Record<string, string>;
  domains: string[];
  features: TenantFeature[];
  // Per-tenant enabled languages (subset of LOCALES, de-duplicated without reordering) and the
  // tenant's chosen default. Both drive routing + pickLocalized fallbacks downstream.
  languages: Locale[];
  defaultLanguage: Locale;
  initials?: string;
  tagline?: Record<string, string>;
  established?: Record<string, string>;
  logo?: string;
  themeColor?: string;
  contact: {
    phone?: string; whatsapp?: string; email?: string;
    address?: Record<string, string>;
    // Social URLs stay flat — they are not localized display strings (BLK-3 §2.2).
    social?: {
      facebookUrl?: string; instagramUrl?: string; xUrl?: string; threadsUrl?: string;
      snapchatUrl?: string; youtubeUrl?: string; linkedinUrl?: string; tiktokUrl?: string;
    };
    hours?: Array<{ day: Record<string, string>; time: Record<string, string> }>;
  };
}

function str(f: any): string | undefined {
  if (f == null) return undefined;
  const v = typeof f === "object" ? (f.en ?? f.ar) : f;
  return v == null ? undefined : String(v);
}

// Normalize the tenant's enabled-languages array. Filter every raw entry through the catalogue
// (LOCALES), de-duplicate without reordering, and only fall back to FALLBACK_LANGUAGES when the
// filtered result is empty. Do NOT cast unvalidated CMS strings to Locale — anything not in the
// catalogue is dropped.
function normalizeLanguages(raw: unknown): Locale[] {
  const seen = new Set<string>();
  const out: Locale[] = [];
  if (Array.isArray(raw)) {
    for (const code of raw) {
      if (typeof code === "string" && (LOCALES as readonly string[]).includes(code) && !seen.has(code)) {
        seen.add(code);
        out.push(code as Locale);
      }
    }
  }
  return out.length > 0 ? out : ([...FALLBACK_LANGUAGES] as Locale[]);
}

// `tenants.type` is a relationship to the extensible tenant-types collection. The site fetches at
// depth=1, so the resolved value is the populated type doc (carrying `slug`); a scalar id has no
// slug and falls back. The frontend only needs the stable type slug (e.g. for Schema.org org type).
function relSlug(rel: any): string | undefined {
  if (rel == null) return undefined;
  if (typeof rel === "string") return rel;
  const slug = rel?.slug;
  return typeof slug === "string" ? slug : undefined;
}

function normalize(doc: any): Tenant {
  const c = doc.contact ?? {};
  const languages = normalizeLanguages(doc.languages);
  // defaultLanguage: accept the stored CMS value only when it survives normalization
  // (is in the enabled set); otherwise use the first normalized language. Never cast an
  // unvalidated string.
  const storedDefault =
    typeof doc.defaultLanguage === "string" && (languages as readonly string[]).includes(doc.defaultLanguage)
      ? (doc.defaultLanguage as Locale)
      : undefined;
  const defaultLanguage: Locale = storedDefault ?? languages[0];
  return {
    id: doc.id,
    slug: str(doc.slug) ?? "",
    type: relSlug(doc.type) ?? "hospital",
    name: toLocalizedMap(doc.name),
    // hasMany text comes back as an array under locale=all it may be wrapped; keep it simple.
    domains: Array.isArray(doc.domains) ? doc.domains.map(String) : [],
    features: Array.isArray(doc.features) ? (doc.features as TenantFeature[]) : [],
    languages,
    defaultLanguage,
    initials: str(doc.branding?.initials),
    tagline: toLocalizedMap(doc.branding?.tagline),
    established: toLocalizedMap(doc.branding?.established),
    logo: imageUrl(doc.branding?.logo),
    themeColor: str(doc.branding?.themeColor),
    contact: {
      phone: str(c.phone),
      whatsapp: str(c.whatsapp), email: str(c.email),
      address: toLocalizedMap(c.address),
      social: {
        facebookUrl: str(c.social?.facebookUrl),
        instagramUrl: str(c.social?.instagramUrl),
        xUrl: str(c.social?.xUrl),
        threadsUrl: str(c.social?.threadsUrl),
        snapchatUrl: str(c.social?.snapchatUrl),
        youtubeUrl: str(c.social?.youtubeUrl),
        linkedinUrl: str(c.social?.linkedinUrl),
        tiktokUrl: str(c.social?.tiktokUrl),
      },
      hours: Array.isArray(c.hours) ? c.hours.map((h: any) => ({
        day: toLocalizedMap(h.day),
        time: toLocalizedMap(h.time),
      })) : [],
    },
  };
}

// ponytail: 60s TTL cache of the whole (small) tenant list. Tenants change rarely; content does not
// flow through here. Bump/clear by restarting the server, same as the rest of the live CMS reads.
let cache: { at: number; tenants: Tenant[] } | null = null;
const TTL = 60_000;

async function loadTenants(): Promise<Tenant[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.tenants;
  try {
    const docs = await getTenants();
    const tenants = docs.map(normalize);
    cache = { at: Date.now(), tenants };
    return tenants;
  } catch (e) {
    // Degrade gracefully: no tenant resolved → callers fall back to unfiltered content + i18n
    // branding (i.e. behaves like the pre-tenant single-hospital site).
    console.warn(`[tenant] could not load tenants: ${e}`);
    return cache?.tenants ?? [];
  }
}

const TENANT_SLUG = import.meta.env?.TENANT_SLUG ?? (typeof process !== "undefined" ? process.env?.TENANT_SLUG : undefined);

export async function resolveTenant(host: string): Promise<Tenant | undefined> {
  const tenants = await loadTenants();
  if (tenants.length === 0) return undefined;
  if (TENANT_SLUG) return tenants.find((t) => t.slug === TENANT_SLUG);
  const h = host.toLowerCase().replace(/:\d+$/, "");
  const byDomain = tenants.find((t) => t.domains.some((d) => d.toLowerCase() === h));
  if (byDomain) return byDomain;
  // Single-tenant deploy with no domain configured → serve the only tenant.
  return tenants.length === 1 ? tenants[0] : undefined;
}

export function hasFeature(tenant: Tenant | undefined, feature: TenantFeature): boolean {
  return tenant ? tenant.features.includes(feature) : false;
}

// Overlay the resolved tenant's identity/contact onto the i18n `strings` so the shared chrome
// (top bar, footer, sidebar, contact) is tenant-driven, falling back to the i18n defaults for any
// value the tenant leaves blank. Returns `strings` untouched when no tenant is resolved.
// ponytail: per-page <title> and BaseLayout JSON-LD are handled separately; this covers the chrome.
export function applyTenant(
  strings: any,
  tenant: Tenant | undefined,
  lang: "ar" | "en",
  healthcareSettings?: HealthcareSettings,
): any {
  if (!tenant) return strings;
  const c = tenant.contact;
  const fallback = tenant.defaultLanguage;
  const hours = (c.hours ?? []).map((h) => ({
    day: pickLocalized(h.day, lang, fallback),
    time: pickLocalized(h.time, lang, fallback),
  }));
  return {
    ...strings,
    site: {
      ...strings.site,
      name: pickLocalized(tenant.name, lang, fallback) || strings.site?.name,
      established: pickLocalized(tenant.established, lang, fallback) || strings.site?.established,
      tagline: pickLocalized(tenant.tagline, lang, fallback) || strings.site?.tagline,
      initials: tenant.initials || strings.site?.initials,
    },
    contact: {
      ...strings.contact,
      details: {
        ...strings.contact?.details,
        address: pickLocalized(c.address, lang, fallback) || strings.contact?.details?.address,
        phone: c.phone || strings.contact?.details?.phone,
        emergencyNumber: healthcareSettings?.emergencyNumber || strings.contact?.details?.emergencyNumber,
        whatsapp: c.whatsapp || strings.contact?.details?.whatsapp,
        email: c.email || strings.contact?.details?.email,
        hours: hours.length ? hours : strings.contact?.details?.hours,
      },
    },
  };
}

// Gate a route: 404 only when a tenant is resolved AND lacks the feature. When no tenant is
// resolved (single-tenant / unseeded), never gate — the site behaves as before.
export function routeGated(tenant: Tenant | undefined, feature: TenantFeature): boolean {
  return !!tenant && !tenant.features.includes(feature);
}
