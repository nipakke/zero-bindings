---
"zero-bindings": minor
---

Expose Zero 1.11 mutator return values. A `success` mutation leg snapshot gains an optional `data` (`ReadonlyJSONValue | undefined`), and `onSuccess`/`onSettled` info carries the same `data`. `MutationLegSnapshot` is now a discriminated union: only `success` has `data`, and its `error` is `undefined`. `data` is untyped JSON, client and server legs may differ, and with no server leg `mutate().server` is the client promise.
