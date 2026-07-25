// Normalizes Payload article `content` blocks (fetched with ?locale=all&depth=1) into a flat,
// render-ready shape. Block structure is shared across locales; text fields inside are localized,
// so each localized field is split into `x` (en) / `xAr` (ar). Rich text is pre-rendered to HTML.
//
// `imageUrl` is injected by the active backend (in-process rewrites to /uploads/…; api prefixes
// the CMS host) so this mapping logic exists in exactly one place for both modes.
import { lexicalToHtml } from "../../lib/lexical";
import type { CmsImageInput } from "../types";

type ImageUrl = (f: CmsImageInput) => string | undefined;

function pick(f: any): [any, any] {
  if (f && typeof f === "object" && ("en" in f || "ar" in f)) return [f.en, f.ar];
  return [f, f];
}

export type ArticleBlock =
  | { type: "richText"; html: string; htmlAr: string }
  | { type: "heading"; level: string; text: string; textAr: string }
  | { type: "image"; url?: string; alt: string; altAr: string; caption?: string; captionAr?: string }
  | { type: "youtube"; url: string; caption?: string; captionAr?: string }
  | { type: "testimonial"; url?: string; text: string; textAr: string; caption?: string; captionAr?: string };

export function normalizeBlocks(raw: any, imageUrl: ImageUrl): ArticleBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: ArticleBlock[] = [];
  for (const b of raw) {
    switch (b?.blockType) {
      case "richText": {
        const [en, ar] = pick(b.richText);
        out.push({ type: "richText", html: lexicalToHtml(en), htmlAr: lexicalToHtml(ar ?? en) });
        break;
      }
      case "heading": {
        const [en, ar] = pick(b.text);
        out.push({ type: "heading", level: b.level ?? "h2", text: String(en ?? ""), textAr: String(ar ?? en ?? "") });
        break;
      }
      case "image": {
        const [alt, altAr] = pick(b.alt);
        const [cap, capAr] = pick(b.caption);
        out.push({ type: "image", url: imageUrl(b.image), alt: String(alt ?? ""), altAr: String(altAr ?? alt ?? ""), caption: cap || undefined, captionAr: capAr || undefined });
        break;
      }
      case "youtube": {
        const [cap, capAr] = pick(b.caption);
        if (b.url) out.push({ type: "youtube", url: String(b.url), caption: cap || undefined, captionAr: capAr || undefined });
        break;
      }
      case "testimonial": {
        const [text, textAr] = pick(b.text);
        const [cap, capAr] = pick(b.caption);
        out.push({ type: "testimonial", url: imageUrl(b.image), text: String(text ?? ""), textAr: String(textAr ?? text ?? ""), caption: cap || undefined, captionAr: capAr || undefined });
        break;
      }
    }
  }
  return out;
}
