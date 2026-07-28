import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import vue from "@astrojs/vue";
import tailwind from "@astrojs/tailwind";
import sitemap from "@astrojs/sitemap";
import { LOCALES, HREFLANG_TAGS, UNPREFIXED_LOCALE } from "./src/i18n";

const site = process.env.PUBLIC_SITE ?? "https://dgh.bitrail.dev";
const base = process.env.PUBLIC_BASE ?? "";
console.log(site, base);

export default defineConfig({
  site,
  base,
  output: "server",
  adapter: node({ mode: "standalone" }),
  i18n: {
    defaultLocale: UNPREFIXED_LOCALE,
    locales: [...LOCALES],
    routing: {
      prefixDefaultLocale: false,
    },
  },
  server: {
    host: true,
    port: parseInt(process.env.PORT ?? "4321"),
  },
  vite: {
    ssr: {
      // @bitrails-works/cms ships TypeScript source (no build step). Vite must compile it for
      // SSR instead of externalizing — otherwise Node tries to import .ts at runtime and fails.
      noExternal: ["@bitrails-works/cms"],
    },
    optimizeDeps: {
      force: true,
    },
    server: {
      hmr: { protocol: "ws" },
    },
  },
  integrations: [
    sitemap({
      i18n: {
        defaultLocale: UNPREFIXED_LOCALE,
        locales: Object.fromEntries(
          LOCALES.map((l) => [l, HREFLANG_TAGS[l]]),
        ),
      },
    }),
    vue({ appEntrypoint: "/src/app.ts" }),
    tailwind({ applyBaseStyles: false }),
  ],
});
