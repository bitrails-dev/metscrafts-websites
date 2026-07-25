import type { CmsImageInput } from "../types";

// Payload serves uploads at /api/<slug>/file/<filename> (on the CMS server). In in-process mode
// the same bytes live in astro/public/uploads/ (media flat, icons under icons/), which Astro
// serves at /uploads/… — so rewrite to a self-contained relative path the browser fetches from
// Astro itself. Other URLs (external, or non-upload relative paths) pass through unchanged.
const UPLOAD_RE = /\/api\/(media|icons)\/file\/([^?#]+)/;

export function payloadUploadUrl(f: CmsImageInput): string | undefined {
  if (f == null) return undefined;
  const raw = typeof f === "string" ? f : f.url;
  if (!raw) return undefined;
  const m = raw.match(UPLOAD_RE);
  if (m) return `/uploads/${m[1] === "icons" ? "icons/" : ""}${m[2]}`;
  return raw;
}
