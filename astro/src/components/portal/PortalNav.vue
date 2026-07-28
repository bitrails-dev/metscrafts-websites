<template>
  <header class="fixed top-0 z-50 w-full bg-white/95 backdrop-blur-md shadow-sm">
    <div class="container mx-auto flex items-center justify-between px-4 py-3">
      <a :href="lp('/')" class="flex items-center gap-3">
        <div class="h-10 w-10 rounded-full bg-navy-900 overflow-hidden">
          <img src="/icon.png" :alt="strings.site.name" class="h-full w-full object-cover" />
        </div>
        <div>
          <p class="text-sm font-bold text-navy-900 leading-tight">{{ strings.site.name }}</p>
          <p class="text-xs text-ink-500">{{ strings.portal.title }}</p>
        </div>
      </a>

      <nav class="hidden md:flex items-center gap-4 text-sm font-semibold">
        <a :href="lp('/portal/')" class="hover:text-navy-900">{{ strings.portal.nav.home }}</a>
        <a :href="lp('/portal/book/')" class="hover:text-navy-900">{{ strings.portal.nav.book }}</a>
        <a :href="lp('/portal/appointments/')" class="hover:text-navy-900">{{ strings.portal.nav.appointments }}</a>
        <a :href="lp('/portal/admin/')" class="hover:text-navy-900">{{ strings.portal.nav.admin }}</a>
      </nav>

      <div class="flex items-center gap-2">
        <!-- Language switcher — hidden on single-language tenants. -->
        <nav
          v-if="languageLinks.length > 1"
          aria-label="Languages"
          class="flex items-center gap-1"
        >
          <a
            v-for="link in languageLinks"
            :key="link.locale"
            class="rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors"
            :class="link.locale === lang
              ? 'border-teal-600 text-teal-800'
              : 'border-ink-200 text-ink-700 hover:border-teal-600 hover:text-teal-800'"
            :href="link.href"
            :hreflang="link.locale"
            :aria-current="link.locale === lang ? 'page' : undefined"
          >
            {{ link.locale.toUpperCase() }}
          </a>
        </nav>

        <a
          v-if="status === 'signed_out'"
          class="rounded-full bg-navy-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy-900/90"
          :href="lp('/portal/sign-in/')"
        >
          {{ strings.portal.nav.signIn }}
        </a>

        <button
          v-else
          class="rounded-full border border-gray-300 px-3 py-1.5 text-xs font-semibold text-ink-900 hover:bg-gray-50"
          @click="onLogout"
        >
          {{ strings.portal.nav.signOut }}
        </button>
      </div>
    </div>

    <div v-if="status === 'signed_in_pending'" class="border-t border-amber-200 bg-amber-50">
      <div class="container mx-auto px-4 py-2 text-xs text-amber-900">
        {{ strings.portal.banner.pendingVerification }}
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { portalApi } from "./api";
import { localePath, languageSwitchLinks, type Locale } from "../../i18n";

const props = defineProps<{
  lang: Locale;
  strings: any;
  // Required (§12): tenant's published language set + its default.
  defaultLanguage: Locale;
  languages: Locale[];
  currentPath?: string;
}>();

type Status = "loading" | "signed_out" | "signed_in_verified" | "signed_in_pending";
const status = ref<Status>("loading");

// Catalogue-driven prefix helper — no hardcoded locale codes.
const lp = (path: string) => localePath(path, props.lang);

// Live URL refs — populated on mount so the persisted island renders the right switcher
// entries after View Transition navigations. Querystring preserved end-to-end.
const livePath = ref(props.currentPath ?? "/");
const liveSearch = ref("");

const languageLinks = computed(() =>
  languageSwitchLinks(livePath.value, liveSearch.value, props.languages),
);

async function refresh() {
  try {
    const me = await portalApi.me();
    status.value = me.patient.verification_status === "verified" ? "signed_in_verified" : "signed_in_pending";
  } catch {
    status.value = "signed_out";
  }
}

async function onLogout() {
  try {
    await portalApi.logout();
  } finally {
    status.value = "signed_out";
    window.location.href = lp('/portal/sign-in/');
  }
}

onMounted(() => {
  if (typeof window !== "undefined") {
    livePath.value = window.location.pathname;
    liveSearch.value = window.location.search;
  }
  refresh();
});
</script>
