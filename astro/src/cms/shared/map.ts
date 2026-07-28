// Content collection mappers, shared by both backends. Each backend supplies its own `fetchDocs`
// (data source) and `imageUrl` (upload URL handling); the doc→entry transformation lives here once.
//
// Localized display fields are emitted as locale maps (Record<locale,string>) via `toLocalizedMap`;
// the paired `…Ar` siblings are gone. Non-display scalars (year, order, slug, color) still use the
// `num`/`str` extractors — they never vary by locale for our purposes (§2.3).
import { toLocalizedMap } from "../../i18n";
import { normalizeBlocks } from "./blocks";
import type { CollectionName, CmsCollectionEntry, CmsImageInput, TenantId } from "../types";

export type ImageUrl = (f: CmsImageInput) => string | undefined;
export type FetchDocs = (slug: string, tenantId?: TenantId) => Promise<any[]>;

// Non-display scalars pull the en/ar projection the way Payload exposes it; only used for fields
// that have no localized display variant (year, order, slug, color, etc.).
function num(f: any): number | undefined {
  if (f == null) return undefined;
  const v = typeof f === "object" ? (f.en ?? f.ar) : f;
  return v == null ? undefined : Number(v);
}
function str(f: any): string | undefined {
  if (f == null) return undefined;
  const v = typeof f === "object" ? (f.en ?? f.ar) : f;
  return v == null ? undefined : String(v);
}
// Relationship field at depth=1 is the related doc; pull a scalar (e.g. slug) off it.
function rel(f: any, key = "slug"): string | undefined {
  if (f == null) return undefined;
  if (typeof f === "object") return f[key] != null ? String(f[key]) : undefined;
  return String(f);
}

const docMappers: Record<CollectionName, (doc: any, imageUrl: ImageUrl) => CmsCollectionEntry> = {
  articles: (doc, imageUrl) => {
    const cat = doc.categoryRel;
    let category, categoryName, categoryColor;
    if (cat && typeof cat === "object") {
      category = cat.slug;
      categoryName = toLocalizedMap(cat.name);
      categoryColor = cat.color;
    }
    return {
      id: doc.slug,
      data: {
        title: toLocalizedMap(doc.title),
        date: new Date(doc.date),
        author: str(doc.author),
        category, categoryName, categoryColor,
        thumbnail: imageUrl(doc.thumbnail),
        featured: doc.featured ?? false,
        content: normalizeBlocks(doc.content, imageUrl),
      },
    };
  },
  achievements: (doc) => ({
    id: doc.slug,
    data: {
      title: toLocalizedMap(doc.title),
      description: toLocalizedMap(doc.description),
      year: num(doc.year)!,
      icon: str(doc.icon),
    },
  }),
  awards: (doc, imageUrl) => ({
    id: doc.slug,
    data: {
      name: toLocalizedMap(doc.name),
      body: toLocalizedMap(doc.body),
      year: num(doc.year)!,
      badgeImage: imageUrl(doc.badgeImage),
    },
  }),
  departments: (doc, imageUrl) => ({
    id: doc.slug,
    data: {
      name: toLocalizedMap(doc.name),
      description: toLocalizedMap(doc.description),
      icon: str(doc.icon),
      iconUrl: imageUrl(doc.iconRef),
      centerOfExcellence: doc.centerOfExcellence ?? false,
    },
  }),
  doctors: (doc, imageUrl) => ({
    id: doc.slug,
    data: {
      name: toLocalizedMap(doc.name),
      specialty: toLocalizedMap(doc.specialty),
      bio: toLocalizedMap(doc.bio),
      photo: imageUrl(doc.photo),
      department: rel(doc.departmentRel) ?? str(doc.department),
      certified: doc.certified ?? false,
      featured: doc.featured ?? false,
      order: num(doc.order),
    },
  }),
  events: (doc, imageUrl) => {
    const gallery = doc.gallery?.map((g: any) => ({
      url: imageUrl(g.image),
      caption: toLocalizedMap(g.caption),
      alt: toLocalizedMap(g.alt),
    }));
    return {
      id: doc.slug,
      data: {
        title: toLocalizedMap(doc.title),
        date: new Date(doc.date),
        category: doc.category,
        summary: toLocalizedMap(doc.summary),
        thumbnail: imageUrl(doc.thumbnail),
        featured: doc.featured ?? false,
        youtubeUrl: str(doc.youtubeUrl),
        gallery,
        body: doc.body,
      },
    };
  },
  testimonials: (doc, imageUrl) => ({
    id: doc.slug,
    data: {
      name: toLocalizedMap(doc.name),
      quote: toLocalizedMap(doc.quote),
      caseType: toLocalizedMap(doc.caseType),
      avatar: imageUrl(doc.avatar),
      featured: doc.featured ?? false,
    },
  }),
  categories: (doc) => ({
    id: doc.slug,
    data: {
      name: toLocalizedMap(doc.name),
      color: str(doc.color),
    },
  }),
};

// Build a `getCollection` for a backend by injecting its data source + image URL strategy.
export function makeGetCollection(fetchDocs: FetchDocs, imageUrl: ImageUrl) {
  return async (name: CollectionName, tenantId?: TenantId): Promise<CmsCollectionEntry[]> => {
    const docs = await fetchDocs(name, tenantId);
    return docs.map((doc) => docMappers[name](doc, imageUrl));
  };
}
