---
title: Sources
---

The pull/subscribe boundary. Everything the core consumes — clients, query signals, `enabled`, TTL, mutators — is a `SourceInput`.

```ts
export type Source<T> = {
  get(): T;
  subscribe(listener: () => void): () => void;
};

export type SourceInput<T> = T | Source<T>;
```

## Contract

- `get()` returns the current value. Core reads it whenever it needs the value and never holds a cached copy of the host's state.
- `subscribe(listener)` reports that the value **may** have changed. It does not need to call `listener` immediately; consumers pull with `get()`.
- The returned unsubscribe function is idempotent: calling it twice is safe.
- Initial reads are explicit. Subscribing does **not** start a resource and does not perform a read on the caller's behalf.

## `createSource`

```ts
export function createSource<T>(
  get: () => T,
  subscribe?: (listener: () => void) => () => void,
): Source<T>;
```

Builds a source from a getter and an optional subscription. When `subscribe` is omitted the source is constant: `get()` still runs, and subscribing is a no-op.

```ts
import { createSource } from "zero-bindings";

const width = createSource(
  () => window.innerWidth,
  (listener) => {
    window.addEventListener("resize", listener);
    return () => window.removeEventListener("resize", listener);
  },
);
```

## `toSource`

```ts
export function toSource<T>(input: SourceInput<T>): Source<T>;
```

Normalizes any input into a `Source`. A value that already has callable `get` and `subscribe` passes through untouched; anything else — including a function-valued query or mutator getter — becomes a constant source whose subscription is a no-op. That is what lets every core input accept a plain value or a reactive source without branching.

```ts
toSource(5); // constant source
toSource(source); // same source, same identity
toSource(() => queries.issue.all()); // a *value* that happens to be a function
```

:::caution
A function passed to `toSource()` stays a value. To make a query getter reactive, wrap its evaluation — the Vue adapter does this in `toCoreQuerySource()`, evaluating the thunk inside a watcher whose subscription drives rematerialization.
:::

Next: [Core concepts](/guide/advanced/core-concepts).
