# zero-bindings

## 0.2.0

### Minor Changes

- ee7208d: Map Zero 1.11's `cached` result type. `QueryStatus` widens to `"complete" | "cached" | "unknown" | "error" | "disabled"`.
  
  **Possible breaking change:** consumers with exhaustive switches (or narrowed types) on `status` must handle `"cached"`. Migration: treat `"cached"` as usable data from a previous sync, possibly stale until `"complete"`.
- ee7208d: **BREAKING:** drop support for `@rocicorp/zero` < 1.11. The peer range is now `>=1.11.0 <1.12.0` and the test matrix runs only Zero 1.11. Adds Zero 1.11 support, including its `holdData()` view hook: queries materialized before the client is ready no longer report `cached` or `error` before their rows are applied.
- ee7208d: Expose Zero 1.11 mutator return values. A `success` mutation leg snapshot gains an optional `data` (`ReadonlyJSONValue | undefined`), and `onSuccess`/`onSettled` info carries the same `data`; the key is absent when the mutator returned nothing. `MutationLegSnapshot` is now a discriminated union: only `success` has `data`, and its `error` is `undefined`. `data` is untyped JSON, client and server legs may differ, and with no server leg `mutate().server` is the client promise.

### Patch Changes

- ee7208d: Fix query snapshots being republished with identical data when a change touched only a relationship outside the query result, such as the one `whereExists` creates.

## 0.1.1

### Patch Changes

- d3b5d88: Add Zero 1.10 to the supported test matrix and widen the `@rocicorp/zero` peer range to `>=1.7.0 <1.11.0`. Compatible per the upstream 1.9.0 to 1.10.0 diff.

## 0.0.8

### Patch Changes

- 07f4b76: Szia
