# Zero contract

Pinned package: `@rocicorp/zero` `1.9.0` in development, peer range `>=1.7.0 <1.10.0`. The test matrix runs `zero-1.7`, `zero-1.8`, and `zero-1.9`; keep this record aligned with `package.json` and `vite.config.ts`. `MutatorResult` is unavailable under that name in 1.7, so `src/core/types.ts` imports the compatible `PromiseWithServerResult` shape.

## Materialization surface

- The view factory is `(query, input, format, onDestroy, onTransactionCommit, queryComplete, updateTTL) => T`.
- `Input` supplies `getSchema()`, `setOutput(output)`, and `fetch({})`. `format.singular` selects the synthetic root `{ "": undefined | [] }`.
- `queryComplete` is `true`, an `ErroredQuery`, or `Promise<true>`. `Output` only requires `push(change, pusher): Stream<"yield">`; `ObservableView` also owns `destroy()` and `updateTTL()`.
- Core imports `applyChange`, `skipYields`, and `DEFAULT_TTL_MS` from `@rocicorp/zero/bindings`. Change tuples are `ADD=0`, `REMOVE=1`, `EDIT=2`, `CHILD=3`; keep the decoder in `src/core/observable-view.ts` synchronized with that upstream encoding.
- `ErroredQuery` may omit `message`; `ObservableView` falls back to `"An unknown error occurred"` when normalizing it. Materialization receives `{ ttl }`; `QueryController` supplies `ttl ?? DEFAULT_TTL_MS`.

## Mutation surface

- A registry mutator is a callable stamped with its dotted `mutatorName`; calling it returns `{ args, "~": "MutateRequest", mutator }`. `src/core/mutation.ts` reads that stamp and otherwise reports `"anonymous"`; it must not reverse-lookup function identity or invent a legacy `mutations` request shape.
- Zero resolves failed legs with `{ type: "error", error: { type, message, details? } }`; the core brands that record as `MutationError` and preserves it as `cause`. A genuine rejection, such as an outstanding leg rejected by `close()`, is an `Error`-shaped value without `type` and passes through unbranded. A mutation issued after close resolves with the error record rather than rejecting.

## Local-only clients

- Tests use the deprecated `server: null` spelling for `cacheURL: null`. Zero still returns both legs: the client leg settles locally, while the underlying server promise remains pending. Core treats a non-`connected` server as unavailable in the snapshot and returns the client promise for `result.server`.
- Closing a client with outstanding local-only server legs is noisy by Zero design: those legs reject and Zero logs one error per outstanding mutation. Await seed writes before closing; each playground's `retire()` owns that ordering (`playgrounds/vue/src/zero/workspace.ts`, `playgrounds/nuxt/app/plugins/zero.ts`, `playgrounds/sveltekit/src/lib/zero/workspace.svelte.ts`).
