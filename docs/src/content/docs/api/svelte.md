---
title: Svelte API
---

Import the adapter from `zero-bindings/svelte`.

## `SvelteBindings.create()`

```ts
const bindings = SvelteBindings.create({
  definitions: createDefinitions({ schema, queries, mutators }),
  client: activeClient,
  // mutations: defaultMutationOptions,
});
```

`client` accepts a Zero client or a getter. Use a getter when the client can change. `mutations` supplies app-level callback and timeout defaults.

`definitions` comes from `createDefinitions()` in the root package. It contains your schema and optional query/mutator registries.

## `ZeroProvider`

```svelte
<ZeroProvider {bindings}>
  {@render children()}
</ZeroProvider>
```

Put the provider above components that call the bindings. Hooks must run during component initialization, or inside a `.svelte.ts` function called from there.

The provider owns the session for its tree. Calling a hook outside a provider throws `Zero Svelte bindings were not provided`.

`bindings.provide()` builds this tree's session and registers the context; `ZeroProvider` calls it during component initialization.

## `useQuery()`

```ts
const result = bindings.useQuery(queryGetter, options?);
```

`queryGetter` may be a direct getter, a registry callback, a registry name, or a registry name/argument tuple:

```ts
bindings.useQuery(() => zql.issue);
bindings.useQuery((queries) => queries.issue.filtered({ projectId }));
bindings.useQuery("issue.all");
bindings.useQuery(["issue.filtered", { projectId }]);
```

```ts
type UseQueryOptions = {
  enabled?: boolean | (() => boolean);
  ttl?: TTL;
};

type MaybeQueryResult<T> = {
  readonly data: HumanReadable<T> | undefined;
  readonly status: "disabled" | "unknown" | "complete" | "error";
  readonly error: (QueryError & { retry(): void }) | undefined;
};
```

Reads of props, `$state`, or `$derived` values inside `queryGetter` are reactive. Pass options as a getter when `enabled` or `ttl` depends on reactive state. Call `result.error?.retry()` to rematerialize after an error.

`unknown` is normal while a live query is streaming and can persist for a local-only client. Render `data` when it exists instead of waiting for `complete`.

## `useMutation()`

```ts
const result = bindings.useMutation(mutatorGetter, options?);
```

`mutatorGetter` supports the same direct, registry callback, name, and tuple forms as `useQuery()`.

```ts
type UseMutationResult<TMutator> = {
  mutate: (...args: Parameters<TMutator>) => MutatorResult;
  reset(): void;
  readonly isPending: boolean;
  readonly error: unknown;
  readonly client: MutationLegSnapshot;
  readonly server: MutationLegSnapshot;
};
```

`mutate()` takes only the mutator's arguments. Its return value contains `client` and `server` promises. `options` accepts callbacks and an optional timeout; bindings-level defaults run before options passed to this call.

## `useSession()`

```ts
const session = bindings.useSession();
```

Use this only when you need core control such as manual resources, `start()`, `stop()`, `setTTL()`, or `dispose()`. See [Session](/api/session) and [core-only usage](/guide/advanced/core-only).

## Lifecycle and SSR

- Call hooks during component initialization.
- Queries and mutations are disposed with their component tree.
- Effects do not run during SSR, so queries start when the browser mounts.
- Create client state and bindings per request when rendering multiple users on the server.

## Related

- [Svelte quickstart](/guide/adapters/svelte)
- [Vue API](/api/vue)
- [Core and adapter-author APIs](/api)
