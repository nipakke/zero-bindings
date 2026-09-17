# AGENTS.md

`zero-bindings` is a framework-neutral Zero package. The root export is the framework-free core; adapters are explicit subpaths: `zero-bindings/vue`, `zero-bindings/svelte`, and the experimental `zero-bindings/experimental_nuxt`.

## Source of truth

- Source and tests are authoritative. Keep this file short; put non-obvious upstream and lifecycle contracts in `.agents/`.
- `createDefinitions()` freezes the definitions container and registries. `ZeroSession.create(definitions, { client, mutations })` creates the live core layer for one host.

## Core invariants

- `Source<T>` is pull-plus-subscribe: notifications carry no value; consumers call `get()`. Constants are normalized with `toSource()`.
- `ZeroSession` owns the current client source, definitions, resource registration, active-query client replacement, and resource disposal. It does not close the Zero client.
- Query resources are inert until `start()`. They own query, `enabled`, and TTL inputs; unchanged resolved keys keep the live view. `stop()` retains the last snapshot; `dispose()` is terminal and resets to `disabled`.
- Query snapshots are `complete | unknown | error | disabled`; data may be `undefined`. A local-only client streams rows while remaining `unknown`.
- `ObservableView` is the only framework-neutral Zero `Output`: hydrate with `fetch`/`skipYields`, apply changes, flush once per transaction, and expose cached snapshots.
- Mutation resources take only mutator arguments and return a two-leg result shaped like Zero's `{client, server}` result; when the server is unavailable, core substitutes the client promise. One generation is active at a time; `reset()`, disposal, or a second call retires older settles. Session client replacement restarts active queries, not mutation generations.
- Mutation callbacks are configured at session `mutations` defaults and resource `MutationOptions`, defaults first. Only landed client/server settles—including timeout errors—call callbacks; `unavailable` is snapshot-only. Resolved Zero failures become `MutationError` with the raw record as `cause`; timeouts become `MutationTimeoutError`.

## Adapter boundary

- Core and `src/index.ts` stay framework-free. Adapters convert framework values into `Source`s, mirror whole core snapshots, and own host teardown; they never reimplement `Output`, materialization, `applyChange`, or `skipYields`.
- `VueBindings.create({ definitions, client, mutations })` is inert until `install(app)`/`app.use(bindings)`. Install provides and returns that host's `ZeroSession`; `app.onUnmount` disposes it. Use composables only after installation.
- `SvelteBindings.create({ definitions, client, mutations })` is inert until `<ZeroProvider {bindings}>`; the provider calls `provide()` during initialization and disposes the session in its effect destructor. Hooks run below the provider during component initialization. Svelte effects do not run during SSR.
- Nuxt is experimental and undocumented. It composes Vue, installs a session client-side only, runs SSR queries through one `useAsyncData`/`zero.run` path, throws from `useSession()` on the server, and keeps mutations browser-only.
- Each bindings instance owns one client source and one injection/context key. Each host installation/tree gets an independent session; use a separate bindings instance when hosts need different client sources. Only Nuxt may import another adapter.

## Layout

| Path                     | Purpose                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/core/`              | `definitions`, `session`, `source`, query/mutation controllers, `ObservableStore`, `ObservableView`, and public core types; no framework imports |
| `src/adapters/vue/`      | Vue source bridge, bindings, mirrors, and lifecycle integration                                                                                  |
| `src/adapters/svelte/`   | raw Svelte runes source/mirror modules, bindings, and `ZeroProvider.svelte`                                                                      |
| `src/adapters/nuxt/`     | experimental SSR layer composed over Vue                                                                                                         |
| `tests/`                 | core, adapter, type, and shared fixture coverage; `tests/fixtures/svelte.svelte.ts` must keep its suffix for the Svelte test plugin              |
| `docs/` / `playgrounds/` | Astro + Starlight docs site (`docs/src/content/docs/`) and dev-only consumers; Nuxt remains undocumented unless requested                        |

## Commands

- `pnpm check` is the gate: `vp check` plus `pnpm check-types`.
- `pnpm check-types` checks the core, Vue, Svelte, Nuxt, and lowest supported Zero 1.7 programs.
- `pnpm test` runs all Zero matrix projects (`zero-1.7`, `zero-1.8`, `zero-1.9`); `pnpm test:watch` watches.
- `pnpm lint` and `pnpm format` run the corresponding Vite+ commands. There is no build step: `files: ["src"]` and package exports intentionally ship source for bundlers.
- For docs only, use `pnpm --filter docs dev` or `pnpm --filter docs build`.
- CI uses pnpm `12.3.4`, Node `24.18.1`, and `pnpm install --frozen-lockfile`.

## Conventions and tests

- ESM and strict TypeScript; local imports use explicit `.ts` extensions. Follow `tsconfig/base.json` rather than adding per-file compiler exceptions.
- Keep framework imports out of `src/core/` and `src/index.ts`; `src/adapters/nuxt/**` is the sole cross-adapter exception.
- The vendored anti-slop Oxlint plugin is part of the gate. Explain unavoidable assertions and runtime decoding with `// SAFETY:` comments; any rule disable needs a narrow reason.
- Tests use real local-only Zero clients (`server: null`, in-memory KV), `vite-plus/test`, and real time. Do not add mocks or fake timers. Keep the host-neutrality test through `src/index.ts` and the plain mirror.
- Keep the Zero version aliases, `vite.config.ts` projects, peer range, and lowest-version type paths in sync when changing supported Zero versions.

## Release and internal contracts

- Add one `.changeset` for each releasable change with `pnpm changeset`. The package is currently private; publishing is disabled.
- `.agents/zero-contract.md` pins upstream Zero shapes; `.agents/view-lifecycle.md` owns `ObservableView` sequencing; `.agents/adapter-rules.md` owns host boundaries; `.agents/core-rationale.md` records deliberate deferrals. Update them when code changes invalidate a contract.
- `ROADMAP.md` contains open work only; do not treat deferred items as shipped behavior.
