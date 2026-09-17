---
title: Mutation resources
---

A mutation resource owns its client and server legs and publishes one cached snapshot; `mutate()` hands the request to the current client.

## Snapshots

```ts
export type MutationLegStatus = "idle" | "pending" | "success" | "error" | "unavailable";

export type MutationLegSnapshot = {
  readonly status: MutationLegStatus;
  readonly error: unknown;
};

export type MutationSnapshot = {
  readonly client: MutationLegSnapshot;
  readonly server: MutationLegSnapshot;
};
```

| Status        | Meaning                                                                       |
| ------------- | ----------------------------------------------------------------------------- |
| `idle`        | Nothing has been sent since creation or `reset()`.                            |
| `pending`     | The leg is in flight.                                                         |
| `success`     | The leg settled successfully.                                                 |
| `error`       | The leg settled with the value in `error`.                                    |
| `unavailable` | No server leg to await at call time: no server configured, or none connected. |

Leg errors are typed `unknown`: Zero mutator error details are reported as a branded `MutationError` at the settle boundary (see [Options](#options)), and any other rejection reason passes through unchanged — formatting belongs to the application.

## `MutationResource`

```ts
export type MutationResource<TMutator extends ZeroMutator> =
  ObservableResource<MutationSnapshot> & {
    mutate(...args: Parameters<TMutator>): MutatorResult;
    reset(): void;
  };
```

| Member        | Behavior                                                                                                                                                                                                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mutate()`    | Resolves the mutator and the session client **per call**, executes `client.mutate()`, and returns Zero's `MutatorResult` — when no server leg can settle, `server` is the client promise itself. Takes only the mutator's arguments: callbacks are configured on the resource and the session, never per call. |
| `reset()`     | Returns the snapshot to `idle` (both legs) and invalidates in-flight settles.                                                                                                                                                                                                                                  |
| `subscribe()` | Reports snapshot changes; unsubscribing is idempotent.                                                                                                                                                                                                                                                         |
| `onDispose()` | Fires once at disposal.                                                                                                                                                                                                                                                                                        |
| `dispose()`   | Terminal; **retains the last snapshot** (unlike a disposed query resource, which resets to `disabled`).                                                                                                                                                                                                        |

`mutate()` can fail synchronously, before any state changes:

- `ClientUnavailableError` — a plain `Error` named `ClientUnavailableError`: no client is attached.
- `DisposedMutationError` — a plain `Error` named `DisposedMutationError`: the resource was disposed.
- `InvalidMutator` — a `{ type, message }` error when a registry getter cannot resolve. Other exceptions thrown by the mutator getter also propagate from `mutate()`.

Only `MutationError` and `MutationTimeoutError` are exported types; the first two guards are identified by `error.name`, not by `instanceof`.

## Options

```ts
export type MutationKind = "client" | "server";

export type MutationInfo = {
  readonly mutatorName: string;
  readonly kind: MutationKind;
  readonly args: readonly unknown[];
};

export type MutationCallbacks = {
  onSuccess?: (info: MutationInfo) => void;
  onError?: (info: MutationInfo & { readonly error: unknown }) => void;
  onSettled?: (info: MutationInfo & { readonly error?: unknown }) => void;
};

export type MutationOptions = MutationCallbacks & {
  timeout?: number;
};

export class MutationError extends Error {}

export class MutationTimeoutError extends MutationError {}
```

`MutationOptions` configures one mutation resource through `session.createMutation(getter, options)`, and the whole app through the session's `mutations` defaults — `ZeroSession.create(definitions, { client, mutations })`, carried by either adapter's `create({ mutations })`. Those defaults stack beneath every resource the session creates.

- **Stacking.** Both layers fire on every settle: the session defaults' callbacks first, then the resource's. A resource `timeout` — if it sets one — replaces the default's.
- `timeout` is in milliseconds, defaults to `5000`; `0` disables the timeout. It bounds how long a **pending** leg may stay pending: on expiry, every still-pending leg settles as `error` with a `MutationTimeoutError` and fires `onError`/`onSettled`. With no live server the server leg is `unavailable` from the start, so an offline queue can never trip a false timeout.
- `mutatorName` is the dot-separated registry name carried by the mutator request (for example `"item.create"`); `args` is the `mutate()` call's argument tuple. A hand-rolled mutator callable that Zero never stamped reports `"anonymous"` rather than a guessed name.
- **Branded errors.** Zero _resolves_ a failed leg with its error skeleton (`{ type: "error", error: { type, message, details? } }`); that exact shape is reported as a `MutationError` whose `cause` is the raw object; a timeout settles as `MutationTimeoutError`. Leg snapshots and callback `error` values carry the branded value; anything else that rejects (e.g. `close()` rejecting outstanding legs) passes through unchanged.
- **Callback isolation.** A callback that throws is reported through `console.error` and never changes the snapshot or the returned promises.
- Callbacks fire once per real settle, in the order the legs settle: the `client` leg is observed first, so a server settle observed after it arrives second. A leg that never ran — no server configured, or not `connected` at `mutate()` time — is terminal `unavailable` in the snapshot and fires no callback: it has no outcome to report. On a local-only client that means exactly one settle per successful call, `kind: "client"`.

**Delivery.** Callbacks hang off the resource's lifetime: disposing the resource, or superseding the run with a second `mutate()`, drops the pending run's callbacks silently, while the awaited `{ client, server }` promises still settle. Reporting that must outlive the view belongs on those promises.

## Settlement rules

- Legs stay distinct: the client leg settles locally, and a server leg that cannot settle at call time — no server configured, or the client is not `connected` — is `unavailable` rather than pending forever. Liveness is a call-time snapshot; a later reconnect does not resurrect a retired leg.
- A failed **client** leg leaves no pending server work: the server leg goes terminal as `unavailable` in the snapshot, without a callback.
- A superseded run — after `reset()`, a newer `mutate()`, or disposal — cannot publish late results; its callbacks are dropped (see Delivery above).
- The published snapshot is replaced wholesale on each transition, so listeners can compare by identity.

## Local-only clients

With `cacheURL: null` (deprecated alias `server: null`), the connection manager reports `NoSocketOrigin` and never starts its connect loop, so client legs settle locally while server legs stay pending forever. The same terminal `unavailable` applies to a configured-but-disconnected client: `mutate()` tracks the server leg only while `connection.state.current.name` is `"connected"` and otherwise returns the client promise as its substitute — offline mutations queue inside Zero, so that leg could not settle within any timeout. Applications running against a local-only client should expect one behavior from Zero itself, outside this package's control:

:::caution
`close()` rejects every still-pending server leg of every mutation that client ever made, and Zero logs one line per mutation. Marking the leg `unavailable` shapes this package's snapshot, not Zero's handler. When you replace a client, let its writes settle before closing it.
:::

Next: [Development](/development).
