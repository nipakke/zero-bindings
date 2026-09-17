---
title: Development
---

Contributor guidance for building adapters and working on zero-bindings.

## Commands

| Command                     | Runs                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm check`                | The gate: format, type-aware lint, and the type checks (`vp check && pnpm check-types`).                                       |
| `pnpm test`                 | The suite once per supported Zero version (`zero-1.7`, `zero-1.8`, `zero-1.9`); one leg with `vp test run --project zero-1.7`. |
| `pnpm check-types`          | The per-area `tsc` legs, plus one `src` + `tests` pass against the lowest supported Zero line.                                 |
| `pnpm format` / `pnpm lint` | `vp fmt` / `vp lint`; both also run inside `pnpm check`.                                                                       |

There is no library build step: the package publishes `src/` and consumers compile it (bundler apps that resolve `.ts` extensions and compile `.svelte` themselves). The docs site has its own commands: `pnpm -C docs dev` and `pnpm -C docs build`. Adding a supported Zero line means touching three places — the version list in `vite.config.ts`, the devDependency alias, and the peer range.

## Pages

- [Make an adapter](/development/make-an-adapter)
