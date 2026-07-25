// Content collection mappers, shared by both backends. Each backend supplies its own `fetchDocs`
// (data source) and `imageUrl` (upload URL handling); the doc→entry transformation lives here once.
import { normalizeBlocks } from "./blocks";
import type { CollectionName, CmsCollectionEntry, CmsImageInput, TenantId } from "../types";

export type ImageUrl = (f: CmsImageInput) => string | undefined;
export type FetchDocs = (slug: string, tenantId?: TenantId) => Promise<any[]>;

function loc(f: any): [string, string] {
  if (f && typeof f === "object") return [f.en ?? "", f.ar ?? ""];
  return [String(f ?? ""), ""];
}
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
    const [title, titleAr] = loc(doc.title);
    const cat = doc.categoryRel;
    let category, categoryName, categoryNameAr, categoryColor;
    if (cat && typeof cat === "object") {
      const [n, nAr] = loc(cat.name);
      category = cat.slug; categoryName = n; categoryNameAr = nAr; categoryColor = cat.color;
    }
    return { id: doc.slug, data: { title, titleAr, date: new Date(doc.date), author: str(doc.author), category, categoryName, categoryNameAr, categoryColor, thumbnail: imageUrl(doc.thumbnail), featured: doc.featured ?? false, content: normalizeBlocks(doc.content, imageUrl) } };
  },
  achievements: (doc) => {
    const [title, titleAr] = loc(doc.title);
    const [description, descriptionAr] = loc(doc.description);
    return { id: doc.slug, data: { year: num(doc.year)!, title, titleAr, description, descriptionAr, icon: str(doc.icon) } };
  },
  awards: (doc, imageUrl) => {
    const [name, nameAr] = loc(doc.name);
    const [body] = loc(doc.body);
    return { id: doc.slug, data: { name, nameAr, body, year: num(doc.year)!, badgeImage: imageUrl(doc.badgeImage) } };
  },
  departments: (doc, imageUrl) => {
    const [name, nameAr] = loc(doc.name);
    const [description, descriptionAr] = loc(doc.description);
    return { id: doc.slug, data: { name, nameAr, description, descriptionAr, icon: str(doc.icon), iconUrl: imageUrl(doc.iconRef), centerOfExcellence: doc.centerOfExcellence ?? false } };
  },
  doctors: (doc, imageUrl) => {
    const [name, nameAr] = loc(doc.name);
    const [specialty, specialtyAr] = loc(doc.specialty);
    const [bio, bioAr] = loc(doc.bio);
    return { id: doc.slug, data: { name, nameAr, specialty, specialtyAr, photo: imageUrl(doc.photo), bio, bioAr, department: rel(doc.departmentRel) ?? str(doc.department), certified: doc.certified ?? false, featured: doc.featured ?? false, order: num(doc.order) } };
  },
  events: (doc, imageUrl) => {
    const [title, titleAr] = loc(doc.title);
    const [summary, summaryAr] = loc(doc.summary);
    const gallery = doc.gallery?.map((g: any) => {
      const [caption, captionAr] = loc(g.caption);
      const [alt] = loc(g.alt);
      return { url: imageUrl(g.image), caption: caption || undefined, captionAr: captionAr || undefined, alt };
    });
    return { id: doc.slug, data: { title, titleAr, date: new Date(doc.date), category: doc.category, summary, summaryAr, thumbnail: imageUrl(doc.thumbnail), featured: doc.featured ?? false, youtubeUrl: str(doc.youtubeUrl), gallery, body: doc.body } };
  },
  testimonials: (doc, imageUrl) => {
    const [name, nameAr] = loc(doc.name);
    const [quote, quoteAr] = loc(doc.quote);
    const [caseType, caseTypeAr] = loc(doc.caseType);
    return { id: doc.slug, data: { name, nameAr, quote, quoteAr, caseType: caseType || undefined, caseTypeAr: caseTypeAr || undefined, avatar: imageUrl(doc.avatar), featured: doc.featured ?? false } };
  },
  categories: (doc) => {
    const [name, nameAr] = loc(doc.name);
    return { id: doc.slug, data: { name, nameAr, color: str(doc.color) } };
  },
};

// Build a `getCollection` for a backend by injecting its data source + image URL strategy.
export function makeGetCollection(fetchDocs: FetchDocs, imageUrl: ImageUrl) {
  return async (name: CollectionName, tenantId?: TenantId): Promise<CmsCollectionEntry[]> => {
    const docs = await fetchDocs(name, tenantId);
    return docs.map((doc) => docMappers[name](doc, imageUrl));
  };
}
