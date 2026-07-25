// Shared contract for the two CMS access backends.
// `cms/index.ts` picks one based on the CMS_MODE env var and re-exports its members, so the
// rest of the app calls `getCollection` / `getTenants` / `imageUrl` without knowing which.

export type TenantId = string | number | undefined;

export type CmsImageInput = string | { url?: string } | null | undefined;

export interface CmsCollectionEntry {
  id: string;
  data: Record<string, any>;
}

export const COLLECTION_NAMES = [
  "articles",
  "achievements",
  "awards",
  "departments",
  "doctors",
  "events",
  "testimonials",
  "categories",
] as const;
export type CollectionName = (typeof COLLECTION_NAMES)[number];

export interface CmsBackend {
  readonly mode: "in-process" | "api";
  getCollection(name: CollectionName, tenantId?: TenantId): Promise<CmsCollectionEntry[]>;
  getTenants(): Promise<any[]>;
  imageUrl(f: CmsImageInput): string | undefined;
}
