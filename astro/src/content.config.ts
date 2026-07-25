// Content is read live from the in-process Payload Local API via `src/lib/cms.ts`
// (`getCollection`) — every page imports from there. The old REST-fetching content-layer
// loaders that lived here were retired when reads moved in-process (Option A), so
// `astro sync` / build no longer require the CMS server to be running.
export const collections = {};
