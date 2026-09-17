# Core rationale

## Keep the core small and framework-free

- `Source<T>` plus `getSnapshot()`/`subscribe()` is the complete host-neutral boundary. `ObservableStore` owns cached snapshot identity, passive subscriptions, disposal, and notification over a listener snapshot; no state library belongs in core.
- `ObservableView` is the single Zero `Output` implementation. It is the materialization extension point that applies Zero changes and exposes snapshots; adapters mirror it instead of creating another view or store.
- `ZeroSession` is the client holder and resource registry. There is no separate runtime object, shared query cache, or cross-resource lifecycle.

## Observable behavior to preserve

- Query inputs (`query`, `enabled`, TTL) are owned while a resource is active. Compare resolved query keys before rematerializing; client replacement fans out only to active queries. Missing clients are `unknown`, falsy queries are `disabled`, and input/materialization failures are snapshots with errors.
- Views hydrate once, apply changes copy-on-write, publish once per transaction, keep snapshots identity-stable when unchanged, and ignore work after destruction.
- Mutation callbacks stack session defaults before resource options. Only landed client/server settles—including timeout errors—call callbacks; `unavailable` is terminal snapshot state without a callback. A resource has one active generation, so teardown/reset or a second call can swallow older undelivered settles; this delivery hole is pinned by `tests/core/mutation.test.ts`.

## Deferred until a real consumer

- Shared query caching/reference counting and cache APIs such as `gcTime`, `find`, `findAll`, or `mutationKey` dedupe.
- App-level mutation reporting, event streams, and refetch policies.
- Per-call mutation options (`mutate(args, options)`).
- A generic adapter base or `createAdapter()`; extract only when a second shipped adapter needs identical code.
- A separate `ZeroRuntime`; the session is sufficient.
