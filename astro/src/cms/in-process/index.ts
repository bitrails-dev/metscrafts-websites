// In-process backend: reads collections + tenants via the Payload Local API (`payload.find`),
// and rewrites upload URLs to Astro-served /uploads/… paths. No CMS server roundtrip.
import type { CmsBackend, TenantId } from "../types";
import { makeGetCollection } from "../shared/map";
import { getCmsPayload } from "./payload";
import { payloadUploadUrl } from "./upload-url";

async function findDocs(collection: string, tenantId?: TenantId, limit = 1000): Promise<any[]> {
  const payload = await getCmsPayload();
  const result = await (payload as any).find({
    collection,
    locale: "all",
    depth: 1,
    limit,
    // Multi-tenant reads are NOT auto-filtered by the plugin on the Local API, so the tenant
    // constraint is applied explicitly (same semantics as the REST ?where[tenant][equals]).
    ...(tenantId != null ? { where: { tenant: { equals: tenantId } } } : {}),
  });
  return result.docs as any[];
}

export const inProcessBackend: CmsBackend = {
  mode: "in-process",
  getCollection: makeGetCollection(
    (slug, tenantId) => findDocs(slug, tenantId, 1000),
    payloadUploadUrl,
  ),
  getTenants: () => findDocs("tenants", undefined, 100),
  imageUrl: payloadUploadUrl,
};
