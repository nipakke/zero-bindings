import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { defineCollection } from "astro:content";
import { z } from "astro/zod";

const preReleaseNotice =
  "<strong>Pre-1.0, unstable.</strong> This package is at <code>0.0.x</code>. Until <code>1.0.0</code>, breaking changes ship in minor and patch releases without a major version bump and without a deprecation window.";

// English-only site: no `i18n` collection, so Starlight uses its built-in UI strings.
export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    // Defaults the Starlight banner for every page; a page can still override its own `banner`.
    schema: docsSchema({
      extend: z.object({
        banner: z.object({ content: z.string() }).default({ content: preReleaseNotice }),
      }),
    }),
  }),
};
