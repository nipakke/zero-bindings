// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },
  runtimeConfig: {
    public: {
      /**
       * Empty keeps the demo local-only; set NUXT_PUBLIC_ZERO_CACHE_URL to
       * enable the experimental payload SSR path.
       */
      zeroCacheURL: "",
    },
  },
  build: {
    // `zero-bindings` publishes `src/` TypeScript only, so Nuxt compiles it.
    transpile: ["zero-bindings"],
  },
  vite: {
    resolve: {
      /**
       * One `@rocicorp/zero` for the whole app. `zero-bindings` is a workspace
       * link, so its sources live outside this package and their own imports
       * would otherwise resolve Zero from the repo root while the app's resolve
       * this package's copy — and Zero brands its query internals
       * (`asQueryInternals`, `applyChange`) per copy, so a query from one copy
       * fails those checks in the other. Deduping pins both to this package.
       */
      dedupe: ["@rocicorp/zero"],
    },
  },
});
