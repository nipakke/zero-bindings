---
title: Make an adapter
---

An adapter converts host values into sources, mirrors core snapshots into host state, and connects host teardown to core disposal.

## Contract

An adapter **may**:

- normalize refs/getters/signals/stores into `Source` objects;
- install host watches so that host-reactive reads drive rematerialization;
- mirror cached resource snapshots into host state (refs, computeds, external stores, signals);
- add host-local decoration, such as the Vue `error.retry` computed that calls `resource.start()`;
- connect host unmount/scope disposal to `session.dispose()` or an individually owned resource's `dispose()`;
- expose convenience composables that go through the session.

An adapter **must not**:

- call `zero.materialize()`, or implement `Output` itself;
- call `applyChange` or `skipYields`;
- reimplement Zero resolution, hashing, query-key comparison, client replacement, TTL forwarding, or completion/error handling;
- keep a parallel query or mutation lifecycle, or its own snapshot cache with different identity rules;
- publish into core snapshots: `QuerySnapshot` stays exactly `{ data, status, error }`.

## The shape

```ts
import { createSource, resolveGetter, type Source } from "zero-bindings";

// 1. host value → Source
const querySource: Source<Query> = createSource(
  () => resolveGetter(queryGetter, definitions.queries, "Query"), // registry → concrete query
  (listener) => hostWatch(queryGetter, listener), // host reactivity → notifications
);

// 2. session → resource
const resource = session.createQuery(querySource, {
  enabled: toSource(enabledInput),
  ttl: toSource(ttlInput),
});
resource.start(); // the adapter decides activation policy

// 3. resource → host state
const snapshot = shallowRef(resource.getSnapshot());
const stop = resource.subscribe(() => {
  snapshot.value = resource.getSnapshot();
});

// 4. host teardown → core disposal
onHostDispose(() => {
  stop();
  resource.dispose();
});
```

Three rules hold for every host:

1. **Sources report, core pulls.** A subscription is a hint; core calls `get()`. Pass sources through `toSource()` so constant and reactive inputs are handled uniformly.
2. **Mirror, don't recompute.** Copy `getSnapshot()` wholesale — do not reconstruct `{ data, status, error }` or mutation state field by field, so whole-snapshot replacement keeps host state aligned with core transitions. Do not derive query state in the adapter — key comparison, TTL, and completion are core behavior every host must agree on.
3. **Teardown explicitly.** Unsubscribe the mirror and dispose the resource. If the adapter created the session, dispose the session too, and never close a client the adapter did not create.

## Vue

`zero-bindings/vue` is the reference adapter:

- `toCoreSource()` converts `MaybeRefOrGetter` inputs into core sources using `toValue()` plus a `watch()` subscription.
- `toCoreQuerySource()` handles function-valued query inputs: `get()` hands core a stable thunk that resolves the current query, and `subscribe()` evaluates that thunk inside a Vue watcher, so reactive reads inside the getter (refs, other getters) drive rematerialization. The session still resolves the query through the core resolver and filters redundant restarts by key.
- Mirrors are `shallowRef` snapshots plus computeds for `data`/`status`/`error` (queries) and `isPending`/`error`/`client`/`server` (mutations), disposed with `onScopeDispose`.
- `VueBindings.create({ definitions, client })` captures the client source — a ref or getter — when the bindings are created; `install(app)` builds that host's session from it and provides it, and `useQuery`/`useMutation`/`useSession` resolve it by injection. One bindings instance owns one injection key, so it is bound to one client source — two clients in one app means two instances over the same definitions — and the instance's client source belongs to the caller, one per installed host. The session `install()` returns is disposed by the host at teardown through `app.onUnmount` (`dispose()` is idempotent). The key and provide/resolve pair live in `src/adapters/vue/create-bindings.ts`; `create-bindings.ts` composes them with the composables and mirrors.
- Evaluation failures never escape into Vue effects: a throwing client source is caught by the session, which detaches and settles active queries as `error`.

## Svelte

`zero-bindings/svelte` is the second shipped adapter, and it proves the boundary holds without a shared interface:

- `toCoreSource()` converts a `MaybeSource` (a constant or a getter reading runes state) into a core source with `get()` plus a `$effect.root`-owned tracking `$effect` for `subscribe()`, so core's unsubscribe disposes the watcher immediately. The first run only records reads — core never gets an initial replay.
- `toCoreQuerySource()` is the same trick for function-valued query inputs: `get()` hands core a stable thunk, `subscribe()` tracks the thunk's reactive reads, and the session filters redundant restarts by key.
- Mirrors are one `$state.raw` snapshot swapped by the resource listener, exposed as plain getters; the query mirror's single `$effect` subscribes, starts, and disposes through its destructor. Effects never run during SSR, so a server render neither starts a resource nor registers teardown — the inert snapshot it reads is what hydrates.
- There is no app object and `setContext` is init-only, so session construction moved into the tree: `SvelteBindings.create()` stays inert (definitions, client source, private key), `ZeroProvider` calls `bindings.provide()` during its own initialization and disposes the session from its `$effect` destructor. One bindings instance owns one context key, so it serves one client per provided tree. The hooks resolve that session with `getContext()` and throw a clear error outside a provided tree.
- Evaluation failures never escape into Svelte effects: a throwing client source is caught by the session, which detaches and settles active queries as `error`.

## Other hosts

**React** — convert the store/input into a `Source` and mirror with `useSyncExternalStore`:

```ts
const snapshot = useSyncExternalStore(
  (listener) => resource.subscribe(listener),
  resource.getSnapshot,
  resource.getSnapshot, // server snapshot
);
```

Start the resource when the component mounts and dispose it on unmount; a shared, session-owned resource can likewise be created once and started by the first consumer. The adapter owns source conversion and component lifecycle bridging; the session owns resolution, replacement, rematerialization, TTL, and disposal.

**Solid** — expose the snapshot through the host's signal shape; start/stop/dispose according to the host lifecycle. (Svelte does exactly this, shipped as `zero-bindings/svelte`.)

**Vanilla** — subscribe directly and render in the listener.

**State libraries** (Nanostores, TanStack Store, …) — mirror `getSnapshot()`/`subscribe()` into a store; the plain test sink under `tests/fixtures/fake-adapter.ts` — a hand-written `subscribe` → array mirror over `session.createQuery` — is the current second demonstration of that boundary. Scope binding, mount behavior, and mount dispatch stay adapter concerns; automatic first-subscriber start is optional wrapper policy, never implicit core behavior.

## Package policy

- The root entry (`zero-bindings`) exports only framework-neutral core APIs and never imports a framework.
- Each adapter is its own subpath entry (`zero-bindings/vue`, `zero-bindings/react`, …) with its framework declared as an **optional peer dependency**.
- Adapters do not depend on each other's state libraries, and no state library is bundled twice.
- Keep request resolution, context attachment, hashing, query-key generation, retry, and materialization in core.

:::caution
The Vue and Svelte adapters demonstrate the same source → session → snapshot contract, but no generic `Adapter` class or `createAdapter()` is needed: host state shapes and lifecycle entry points differ, while the shared orchestration already belongs in core. Extract a helper only when a future adapter needs the same code unchanged.
:::

Next: [Core-only and other frameworks](/guide/advanced/core-only).
