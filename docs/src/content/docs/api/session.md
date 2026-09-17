---
title: Session
---

`createDefinitions()` produces immutable definitions; `ZeroSession.create()` turns them into the live Zero layer of one application instance.

## `createDefinitions`

```ts
export type Definitions<
  TSchema extends Schema,
  TContext extends BaseDefaultContext = BaseDefaultContext,
  TQueries = undefined,
  TMutators = undefined,
> = Readonly<{
  readonly schema: TSchema;
  readonly context: TContext;
  readonly queries: TQueries;
  readonly mutators: TMutators;
}>;

export type DefinitionsOptions<TSchema, TContext, TQueries, TMutators> = {
  readonly schema: TSchema;
  readonly context?: TContext;
  readonly queries?: TQueries;
  readonly mutators?: TMutators;
};

export function createDefinitions(options: DefinitionsOptions<...>): Definitions<...>;
```

Freezes the caller's `queries`/`mutators` objects in place and returns a frozen container. Definitions hold no client, subscriptions, resources, controllers, or mutable runtime state, so one `createDefinitions()` result can back many sessions (for example one per SSR request or per test).

## Getter resolution

A query/mutator getter is resolved against the bound registry when the resource reads its input:

| Getter form                         | Resolves to                                                |
| ----------------------------------- | ---------------------------------------------------------- |
| `(queries) => queries.issue.all()`  | the callback result, called with the registry              |
| `"issue.all"`                       | the registry entry, called with no arguments               |
| `["issue.filtered", { projectId }]` | the registry entry, called with the tuple's extra elements |
| `() => directQueryOrMutator`        | the direct signal, called with no arguments                |

Resolution rules and failures:

- A function whose `length > 0` receives the registry; a zero-argument function is called directly. With no registry bound, a function that requires arguments is invalid.
- Names and tuples require a registry. An unknown name throws `Unknown query "<name>"`, extra arguments on a non-callable entry throw, and both surface as `{ type: "InvalidQuery" \| "InvalidMutator", message }`.
- `resolveGetter(getter, registry, kind)` is exported for adapters that need to resolve a getter themselves — both shipped adapters do.

## `ZeroSession.create`

```ts
export type ZeroSessionOptions<TSchema, TContext, MD> = {
  readonly client: SourceInput<Zero<TSchema, MD, TContext> | undefined>;
  readonly mutations?: MutationOptions | undefined;
};

// static member of `ZeroSession`; the constructor is private.
static create(definitions, options): ZeroSession<...>;
```

`client` accepts a plain client, a ref/getter already bridged into a source, or a core `Source`. The session subscribes to it and owns the current value. Creation-time reads are guarded: a client source that throws settles the session in the error state instead of throwing out of `ZeroSession.create()`. `mutations` sets app-level [`MutationOptions`](/api/mutation-resource#options) defaults for every mutation resource the session creates: the defaults' callbacks fire before each resource's own, and a resource without a `timeout` inherits the default's.

## `ZeroSession`

```ts
export class ZeroSession<
  TSchema extends Schema,
  TContext extends BaseDefaultContext,
  TQueries,
  TMutators,
  MD extends CustomMutatorDefs | undefined,
> {
  static create(definitions, options): ZeroSession<TSchema, TContext, TQueries, TMutators, MD>;

  readonly definitions: Definitions<TSchema, TContext, TQueries, TMutators>;
  get client(): Zero<TSchema, MD, TContext> | undefined;

  setClient(client: Zero<TSchema, MD, TContext> | undefined): void;

  createQuery<TTable extends keyof TSchema["tables"] & string, TReturn>(
    queryGetter: SourceInput<
      QueryGetter<TQueries, QuerySignalQuery<TSchema, TTable, TReturn, TContext>>
    >,
    options?: BindingQueryOptions,
  ): QueryResource<HumanReadable<TReturn> | undefined>;

  createMutation<TMutator extends ZeroMutator>(
    mutatorGetter: SourceInput<MutatorGetter<TMutators, TMutator>>,
    options?: MutationOptions,
  ): MutationResource<TMutator>;

  dispose(): void;
}
```

| Member             | Behavior                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create`           | The only entry point: the constructor is private. `create()` builds the session and subscribes to its client source.                               |
| `definitions`      | The registry the session was created from.                                                                                                         |
| `client`           | The current client, or `undefined` while detached.                                                                                                 |
| `setClient(next)`  | Low-level replacement: attaches, replaces, or detaches, rematerializing active queries in place.                                                   |
| `createQuery()`    | Registers a query resource. The resource is inert until `start()`.                                                                                 |
| `createMutation()` | Registers a mutation resource. Its source evaluation is lazy per call, so it picks up the current client.                                          |
| `dispose()`        | Terminal and idempotent: stops the client subscription, disposes registered resources, and invalidates late callbacks. It never closes the client. |

### `BindingQueryOptions`

```ts
export type BindingQueryOptions = {
  readonly enabled?: SourceInput<boolean>;
  readonly ttl?: SourceInput<TTL | undefined>;
};
```

Both accept values or sources, read per resource — which is what makes an adapter's options getter reactive. `enabled` defaults to `true`; `ttl` defaults to Zero's `DEFAULT_TTL_MS`. Flipping `enabled` to `false` publishes the `disabled` snapshot, flipping it back rematerializes, and a TTL change updates the live view without rematerializing — see [query resources](/api/query-resource#inputs) for the full input semantics.

## Client replacement

Replacing client A with client B:

1. stores B as the current client,
2. restarts every **active** query resource in place — same resource, same listeners, same adapter mirrors,
3. destroys the old materialized view and synchronously installs the new one,
4. publishes no teardown-only state.

Replacing with `undefined` publishes the stable `unknown` snapshot instead: `{ data: undefined, status: "unknown", error: undefined }`. A client source that throws is recorded: the session detaches, active queries settle as `error` with a `MaterializationError` carrying the thrown message, and the error clears on the next successful read or `setClient()`.

In-flight mutations stay tied to the client captured when `mutate()` was called. Closing a replaced client is the caller's business — the session never closes clients it did not create.

## Session isolation

Create one session per test, worker, or application instance (for Vue, one per app via `install()`; one bindings instance is bound to one client source, so two clients on one app means two instances over the same definitions). The session returned by Vue's `install(app)` is what the host disposes at teardown through `app.onUnmount` (`dispose()` is idempotent). A server render that installs the bindings still creates a session and registers that hook, but `app.onUnmount` does not run during SSR; dispose the returned session at request teardown.
