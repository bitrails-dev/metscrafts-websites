// REST ("api") backend: reads collections + tenants over HTTP from the running CMS server
// (CMS_URL), and points upload URLs at that same CMS origin. This is the pre-migration mode —
// kept so a single env flip (CMS_MODE=api) falls back to the external CMS without code changes.
import type { CmsBackend, TenantId } from "../types";
import { makeGetCollection } from "../shared/map";
import { normalizeHealthcareSettingsDocs } from "../shared/healthcare-settings";
import { apiUploadUrl } from "./upload-url";

const CMS = import.meta.env?.CMS_URL ?? "http://localhost:3001";

async function fetchDocs(slug: string, tenantId?: TenantId, limit = 1000): Promise<any[]> {
  const where = tenantId != null ? `&where[tenant][equals]=${encodeURIComponent(String(tenantId))}` : "";
  const url = `${CMS}/api/${slug}?locale=all&depth=1&limit=${limit}${where}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Payload /${slug} returned ${res.status}: ${await res.text()}`);
  return ((await res.json()) as any).docs;
}

export const apiBackend: CmsBackend = {
  mode: "api",
  getCollection: makeGetCollection(
    (slug, tenantId) => fetchDocs(slug, tenantId, 1000),
    apiUploadUrl,
  ),
  getTenants: async () => fetchDocs("tenants", undefined, 100),
  getHealthcareSettings: async (tenantId) => normalizeHealthcareSettingsDocs(await fetchDocs("healthcare-settings", tenantId, 1)),
  imageUrl: apiUploadUrl,
};
