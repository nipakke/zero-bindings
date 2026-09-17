// @ts-check
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightLlmsTxt from "starlight-llms-txt";

export default defineConfig({
  site: "https://zero-bindings.zhorna.workers.dev",
  integrations: [
    starlight({
      title: "zero-bindings",
      description: "Use an existing Zero client through small, typed Vue and Svelte adapters.",
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/nipakke/zero-bindings" },
      ],
      customCss: ["./src/styles/custom.css"],
      plugins: [
        starlightLlmsTxt({
          projectName: "zero-bindings",
          description: "Typed Zero bindings for Vue and Svelte.",
          details:
            "Install and integrate the Vue or Svelte adapter, then use typed reactive queries and mutations.",
        }),
      ],
      sidebar: [
        {
          label: "Guide",
          items: [
            { label: "Get started", slug: "guide" },
            { label: "Adapters", items: ["guide/adapters/vue", "guide/adapters/svelte"] },
            {
              label: "Advanced",
              items: ["guide/advanced/core-concepts", "guide/advanced/core-only"],
            },
          ],
        },
        {
          label: "API reference",
          items: [
            { label: "Overview", slug: "api" },
            "api/source",
            "api/session",
            "api/query-resource",
            "api/mutation-resource",
            "api/vue",
            "api/svelte",
          ],
        },
        {
          label: "Development",
          items: [{ label: "Overview", slug: "development" }, "development/make-an-adapter"],
        },
      ],
    }),
  ],
});
