import type { CmsImageInput } from "../types";

const CMS = import.meta.env?.CMS_URL ?? "http://localhost:3001";

// In "api" mode the Next CMS server is running and serves uploads at ${CMS_URL}/api/<slug>/file/
// <filename>. Prefix relative upload paths with the CMS origin; absolute/external URLs pass through.
export function apiUploadUrl(f: CmsImageInput): string | undefined {
  if (f == null) return undefined;
  const raw = typeof f === "string" ? f : f.url;
  if (!raw) return undefined;
  return raw.startsWith("/") ? `${CMS}${raw}` : raw;
}
