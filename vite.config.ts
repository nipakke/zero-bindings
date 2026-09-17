import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite-plus";

/**
 * Zero versions under test — each needs a matching devDependency alias in
 * package.json (`"zero-1.7": "npm:@rocicorp/zero@1.7.0"`). Every entry here runs
 * the whole suite as its own Vitest project with `@rocicorp/zero` and its
 * `bindings` subpath resolving to that copy, so `vp test run --project zero-1.7`
 * runs one leg. Add or drop a version in this list, in package.json, and in the
 * peer range; `tsconfig.zero-1.7.json` follows the lowest one.
 */
const zeroVersions = ["zero-1.7", "zero-1.8", "zero-1.9"];

export default defineConfig({
  // Compiles the Svelte adapter and its `.svelte` test fixtures; `runes: true`
  // matches the library convention (the adapter's modules are `.svelte.ts`).
  plugins: [svelte({ compilerOptions: { runes: true } })],
  resolve: {
    // Vitest's jsdom projects must run the browser builds of framework
    // runtimes (Svelte's `mount` lives in the client entry only).
    conditions: ["browser"],
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    // Every test client is local-only `server: null`, so Zero `console.warn`s
    // once per client that it will sync nothing. Expected here — drop it, and
    // drop only it: this is Vitest's console filter, not a blanket mute.
    onConsoleLog: (log) =>
      !/^Zero (?:started in an unsupported environment|starting up with no server URL)/.test(log),
    projects: zeroVersions.map((zeroVersion) => ({
      extends: true,
      test: { name: zeroVersion },
      resolve: {
        alias: {
          "@rocicorp/zero": zeroVersion,
          "@rocicorp/zero/bindings": `${zeroVersion}/bindings`,
        },
      },
    })),
  },
  fmt: {
    // The README is hand-formatted; keep the formatter off it. Agent tooling
    // assets and the vendored anti-slop plugin are owned copies, not source.
    ignorePatterns: [
      "ROADMAP.md",
      "CHANGELOG.md",
      "README.md",
      ".agent/**",
      ".agents/**",
      ".claude/**",
      ".codex/**",
      ".continue/**",
      ".cursor/**",
      ".gemini/**",
      ".opencode/**",
      ".pi/**",
      ".roo/**",
      ".windsurf/**",
      "tools/oxlint/anti-slop/**",
    ],
  },
  lint: {
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: [
      ".agent/**",
      ".agents/**",
      ".claude/**",
      ".codex/**",
      ".continue/**",
      ".cursor/**",
      ".gemini/**",
      ".opencode/**",
      ".pi/**",
      ".roo/**",
      ".windsurf/**",
      "tools/oxlint/anti-slop/**",
      "docs/**",
    ],
    jsPlugins: [{ name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" }],
    rules: {
      "oxc/no-accumulating-spread": "error",
      "anti-slop/no-array-filter-map": "error",
      "anti-slop/no-reduce-accumulator-copy": "error",
      "anti-slop/no-chained-type-assertions": "error",
      "anti-slop/no-conditional-empty-object-spread": "error",
      "anti-slop/no-known-value-widening": "error",
      "anti-slop/no-module-mocking": "error",
      "anti-slop/no-object-parameters": "error",
      "anti-slop/no-reflect-apply": "error",
      "anti-slop/no-reflect-get": "error",
      "anti-slop/no-runtime-typeof": "error",
      "anti-slop/no-shape-in-symbol-names": "error",
      "anti-slop/no-unknown-parameters": "error",
      "anti-slop/no-unknown-returns": "error",
      "anti-slop/no-unknown-type-aliases": "error",
      "anti-slop/no-unsafe-dictionary-type": "error",
      "anti-slop/no-widen-then-assert": "error",
      "anti-slop/require-readable-spacing": "error",
      "anti-slop/require-safety-comment-for-type-assertion": "error",
    },
  },
});
