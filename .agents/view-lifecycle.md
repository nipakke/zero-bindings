# View lifecycle

1. **Construct:** create the synthetic root `{ "": format.singular ? undefined : [] }`, obtain the schema, call `setOutput`, register `onTransactionCommit(flush)`, handle `queryComplete`, then hydrate with `skipYields(input.fetch({}))` and `applyChange`.
2. **Hydrate and push:** hydration applies into a fresh root with `mutate: true`; `push(change)` applies incrementally with a transaction `WeakSet` for copy-on-write, marks dirty, and returns one shared empty stream because this view never yields.
3. **Flush:** commit swaps the cached snapshot and notifies once per transaction; reset the transaction `WeakSet`. Snapshot identity stays stable when nothing changed.
4. **Completion and errors:** `true` is complete, `ErroredQuery` is error, and `Promise<true>` settles asynchronously. Throws from schema/fetch/push/commit and reported query failures become error snapshots, never uncaught materialize/commit failures.
5. **TTL:** `ObservableView.updateTTL(ttl)` only forwards to the factory callback. `QueryController` owns the value and supplies `ttl ?? DEFAULT_TTL_MS` both when materializing and when `setTTL()` updates a live view.
6. **Destroy:** `destroy()` is terminal: run `onDestroy`, clear listeners, and ignore later push/promise settlements. Later `subscribe()` and `unsubscribe()` are no-ops/idempotent. Resources own `dispose()`; the view only owns `destroy()`.
