// Normalizes Payload article `content` blocks (fetched with ?locale=all&fallback-locale=none&depth=1)
// into a flat, render-ready shape. Block structure is shared across locales; localized fields are
// emitted as locale maps (Record<locale,string>). Rich text is pre-rendered to HTML per catalogue
// locale once, here in the mapper — no per-request Lexical render.
//
// `imageUrl` is injected by the active backend (in-process rewrites to /uploads/…; api prefixes
// the CMS host) so this mapping logic exists in exactly one place for both modes.
import { lexicalToHtml } from "../../lib/lexical";
import { LOCALES, toLocalizedMap } from "../../i18n";
import type { CmsImageInput } from "../types";

type ImageUrl = (f: CmsImageInput) => string | undefined;

export type ArticleBlock =
  | { type: "richText"; html: Record<string, string> }
  | { type: "heading"; level: string; text: Record<string, string> }
  | { type: "image"; url?: string; alt: Record<string, string>; caption: Record<string, string> }
  | { type: "youtube"; url: string; caption: Record<string, string> }
  | { type: "testimonial"; url?: string; text: Record<string, string>; caption: Record<string, string> };

// Render a localized Payload field into a locale → string map by applying `render` to each present
// locale value. Empty/null entries are dropped (consistent with toLocalizedMap). Used for richText,
// where each locale's Lexical tree is independently serialized.
function renderLocalizedMap(f: any, render: (v: any) => string): Record<string, string> {
  const out: Record<string, string> = {};
  if (f && typeof f === "object" && !Array.isArray(f)) {
    for (const code of LOCALES) {
      const v = (f as Record<string, any>)[code];
      if (v != null && v !== "") out[code] = render(v);
    }
  }
  return out;
}

export function normalizeBlocks(raw: any, imageUrl: ImageUrl): ArticleBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: ArticleBlock[] = [];
  for (const b of raw) {
    switch (b?.blockType) {
      case "richText": {
        out.push({ type: "richText", html: renderLocalizedMap(b.richText, lexicalToHtml) });
        break;
      }
      case "heading": {
        out.push({ type: "heading", level: b.level ?? "h2", text: toLocalizedMap(b.text) });
        break;
      }
      case "image": {
        out.push({
          type: "image",
          url: imageUrl(b.image),
          alt: toLocalizedMap(b.alt),
          caption: toLocalizedMap(b.caption),
        });
        break;
      }
      case "youtube": {
        if (b.url) out.push({ type: "youtube", url: String(b.url), caption: toLocalizedMap(b.caption) });
        break;
      }
      case "testimonial": {
        out.push({
          type: "testimonial",
          url: imageUrl(b.image),
          text: toLocalizedMap(b.text),
          caption: toLocalizedMap(b.caption),
        });
        break;
      }
    }
  }
  return out;
}
