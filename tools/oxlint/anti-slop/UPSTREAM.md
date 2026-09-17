# Vendored anti-slop Oxlint plugin

Source: the `install-anti-slop` skill bundled in this repository at
`.agents/skills/install-anti-slop/assets/anti-slop/`, installed with
`.agents/skills/install-anti-slop/scripts/install.mjs` on 2026-09-14.

Installed path: `tools/oxlint/anti-slop/` (generic entry `index.ts`; the
opt-in Effect plugin lives in `effect/` and is not registered — this
repository has no `effect` dependency).

Verification: `diff -rq` against the skill's `assets/anti-slop/` snapshot
returned no differences at install time, so the copy is pristine relative to
the local skill asset. The skill assets themselves were committed in
`f4ed03f`; a further-upstream repository revision for the generic plugin was
not recorded by the skill and is unknown here.

Intentional deviations: none in the copied source. Local modifications are
limited to configuration in `vite.config.ts` (`lint.jsPlugins`, `lint.rules`,
`lint.ignorePatterns`, matching `fmt.ignorePatterns`) and the exact-pin
devDependency `@oxlint/plugins@1.82.0` matching the `oxlint@1.82.0` brought
in by `vite-plus@0.3.2`.

The nested `vendor/eslint-stylistic/UPSTREAM.md` records provenance for the
one rule vendored from ESLint Stylistic; keep its `LICENSE` with every
redistributed copy.

Updating: follow `.agents/skills/install-anti-slop/references/update.md` —
preserve any local rule changes, then re-verify with `pnpm check`.
