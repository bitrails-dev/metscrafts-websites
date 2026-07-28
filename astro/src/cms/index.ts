// CMS access layer — one switchable backend for content reads, tenant reads, and upload URLs.
//
// Two implementations live behind the `CmsBackend` interface (./types):
//   - ./in-process  Payload Local API (`payload.find`), self-contained, no CMS server needed.
//   - ./api         REST fetch to the CMS server (CMS_URL), the pre-migration behaviour.
//
// Select at startup with the CMS_MODE env var: `in-process` (default) or `api`. The mapper +
// tenant-normalization logic is shared (./shared), so only the data source + image URL differ.
import type { CmsBackend, CmsImageInput, CollectionName, TenantId } from "./types";
import { payloadUploadUrl } from "./in-process/upload-url";
import { apiUploadUrl } from "./api/upload-url";

export type { CmsBackend, CmsCollectionEntry, CmsImageInput, CollectionName, TenantId } from "./types";
export type { HealthcareSettings, LocalizedStat } from "./shared/healthcare-settings";

const MODE: "in-process" | "api" = process.env.CMS_MODE === "api" ? "api" : "in-process";

export function getCmsMode(): "in-process" | "api" {
  return MODE;
}

// Lazy backend load so the unused one — in-process drags in the full Payload config — is not
// pulled into the bundle when the other mode is active.
let _backendPromise: Promise<CmsBackend> | undefined;
function backend(): Promise<CmsBackend> {
  if (!_backendPromise) {
    _backendPromise =
      MODE === "api"
        ? import("./api").then((m) => m.apiBackend)
        : import("./in-process").then((m) => m.inProcessBackend);
  }
  return _backendPromise;
}

export async function getCollection(name: CollectionName, tenantId?: TenantId) {
  return (await backend()).getCollection(name, tenantId);
}

export async function getTenants() {
  return (await backend()).getTenants();
}

export async function getHealthcareSettings(tenantId: TenantId) {
  return (await backend()).getHealthcareSettings(tenantId);
}

// imageUrl is needed synchronously in templates; both impls are tiny and dependency-free, so
// pick one eagerly based on the mode (no lazy import needed here).
export function imageUrl(f: CmsImageInput) {
  return MODE === "api" ? apiUploadUrl(f) : payloadUploadUrl(f);
}
