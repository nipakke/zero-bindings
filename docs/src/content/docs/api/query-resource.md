---
title: Query resources
---

One materialized query: its inputs, its Zero view, and the cached snapshot consumers read.

## Snapshots

```ts
export type QueryStatus = "complete" | "unknown" | "error" | "disabled";

export type QueryError = { type: string; message: string; details?: unknown };

/** Human-readable data as published to consumers. */
export type QueryResult<TReturn> = HumanReadable<TReturn> | undefined;

export type QuerySnapshot<T> = {
  readonly data: T | undefined;
  readonly status: QueryStatus;
  readonly error: QueryError | undefined;
};
```

| Status     | Meaning                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------- |
| `disabled` | The resource has no view: `enabled` is `false`, the resolved signal is falsy, or it was disposed. |
| `unknown`  | No client is attached yet, or the view has not completed its first read.                          |
| `complete` | `data` holds the materialized result.                                                             |
| `error`    | `error` holds `{ type, message, details? }`; `data` is `undefined`.                               |

`getSnapshot()` is cached: consecutive reads without an observable state change are referentially equal. Snapshots are read-only for consumers, and the shape stays exactly three fields — retry decoration and other host-specific values belong in an adapter computed, not here.

## Errors

`error.type` says where the failure came from; `error.details` is present only when Zero supplied it.

| `type`                 | Raised when                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `InvalidQuery`         | The getter did not resolve: unknown registry entry, arguments passed to an entry that takes none, or a signal that is not a query. |
| `QuerySignalError`     | Reading the query signal, `enabled`, or `ttl` threw.                                                                               |
| `MaterializationError` | The client source threw, or `materialize()` failed before any rows were published.                                                 |
| Zero's own error type  | The query itself failed; `type` is Zero's `ErroredQuery` error name (or a thrown `Error.name`) and `message` comes from Zero.      |

A detached session is not an error: with no client attached the snapshot stays `{ data: undefined, status: "unknown", error: undefined }`.

## `ObservableResource`

```ts
export type ObservableResource<T> = {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
  onDispose(listener: () => void): () => void;
  dispose(): void;
};
```

- `subscribe(listener)` reports state changes; it never starts a resource and unsubscribing is idempotent.
- `onDispose(listener)` subscribes to disposal; it fires once, after which the resource is terminal.
- `dispose()` is idempotent and prevents later source, view, or promise callbacks from doing work.

## `QueryResource`

```ts
export type QueryResource<T> = ObservableResource<QuerySnapshot<T>> & {
  readonly active: boolean;
  start(): void;
  stop(): void;
  setTTL(ttl: TTL | undefined): void;
};
```

| Member        | Behavior                                                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `active`      | Whether the resource is started. `stop()` and `dispose()` clear it.                                                                |
| `start()`     | Unconditionally re-reads current inputs and retries materialization — even when the key is unchanged. Also retries after an error. |
| `stop()`      | Releases the materialized view and the input subscriptions; retains the last snapshot (no transition is published).                |
| `setTTL(ttl)` | Updates the live view's TTL; `undefined` restores Zero's `DEFAULT_TTL_MS`, for the live view and the next materialization.         |

While active, the resource subscribes to its query signal, `enabled`, and TTL inputs. An input notification rematerializes only when it changes the resolved query key — a reactive input that re-resolves to the same query is free. Disabled values, falsy signals, and resolution errors rematerialize unconditionally. Source reactions never restart a stopped resource: only an explicit `start()` does.

## Inputs

- `enabled` is read on every materialization. Flipping it to `false` publishes the `disabled` snapshot and drops the previous `data`; flipping it back rematerializes.
- `ttl` takes Zero's TTL shapes — milliseconds, `1m`-style strings, `"forever"`, `"none"` — and `undefined` restores Zero's `DEFAULT_TTL_MS`. Zero clamps whatever it is handed to its own maximum.
- The TTL input is applied when its value changes, so a manual `setTTL()` survives until then.

## `QuerySignalQuery`

```ts
export type QuerySignalQuery<TSchema, TTable, TReturn, TContext, TInput, TOutput> =
  QueryOrQueryRequest<TTable, TInput, TOutput, TSchema, TReturn, TContext> | Falsy;
```

The resource reads the signal, converts a query request into a query with the client's context, and derives the identity key that tells two materializations apart. A falsy signal resolves `disabled`; a thrown value resolves `error` with a plain `{ type, message }` snapshot error.

## `ObservableView`

```ts
export class ObservableView<TReturn> implements Output {
  getSnapshot(): QuerySnapshot<HumanReadable<TReturn>>;
  subscribe(listener: () => void): () => void;
  push(change: Change): Stream<"yield">; // Output implementation
  updateTTL(ttl: TTL): void;
  destroy(): void;
}

export function observableViewFactory<TTable, TSchema, TReturn>(
  query: Query<TTable, TSchema, TReturn>,
  input: Input,
  format: Format,
  onDestroy: () => void,
  onTransactionCommit: (cb: () => void) => void,
  queryComplete: true | ErroredQuery | Promise<true>,
  updateTTL: (ttl: TTL) => void,
): ObservableView<TReturn>;
```

`ObservableView` is the one framework-neutral implementation of Zero's `Output` contract. It owns the materialized tree, transaction batching, completion/error handling, the cached snapshot, listener notification, and view destruction, and invokes the TTL callback supplied by core:

```text
Zero changes
  → ObservableView.push(change)
  → apply change to the internal materialized tree
  → transaction commit
  → replace the cached snapshot
  → notify subscribers once
```

`observableViewFactory` is the factory to hand to `zero.materialize()`. Adapters must not call materialization themselves, and must not implement `Output`, `applyChange`, or `skipYields`.
