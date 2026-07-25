// Block normalization lives in the CMS access layer (../cms/shared/blocks), where `imageUrl` is
// injected by the active backend (in-process rewrites to /uploads/…; api prefixes the CMS host).
// Re-exported here so existing `import { normalizeBlocks } / type { ArticleBlock }` still work.
export { normalizeBlocks, type ArticleBlock } from "../cms/shared/blocks";
