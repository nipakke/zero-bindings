---
title: Vue API
---

Import the adapter from `zero-bindings/vue`.

## `VueBindings.create()`

```ts
const bindings = VueBindings.create({
  definitions: createDefinitions({ schema, queries, mutators }),
  client: activeClient,
  // mutations: defaultMutationOptions,
});
```

`client` accepts a Zero client, a Vue ref, or a getter. Use a ref or getter when the client can change. `mutations` supplies app-level callback and timeout defaults.

`definitions` comes from `createDefinitions()` in the root package. It contains your schema and optional query/mutator registries.

## Install

```ts
app.use(bindings);
```

Or call `bindings.install(app)` directly. The direct call returns the installed session; `app.use(bindings)` returns the Vue app.

The Vue adapter has no SSR payload or hydration path. `install()` still builds and provides the session; because `app.onUnmount` does not run during SSR, dispose the session returned by `install(app)` at request teardown.

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
  enabled?: MaybeRefOrGetter<boolean>;
  ttl?: TTL;
};

type MaybeQueryResult<T> = {
  data: ComputedRef<HumanReadable<T> | undefined>;
  status: ComputedRef<"disabled" | "unknown" | "complete" | "error">;
  error: ComputedRef<(QueryError & { retry(): void }) | undefined>;
};
```

Reads of refs, props, or computeds inside `queryGetter` are reactive. Pass options as a getter when `enabled` or `ttl` depends on reactive state. Call `result.error.value?.retry()` to rematerialize after an error.

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
  isPending: ComputedRef<boolean>;
  error: ComputedRef<unknown>;
  client: ComputedRef<MutationLegSnapshot>;
  server: ComputedRef<MutationLegSnapshot>;
};
```

`mutate()` takes only the mutator's arguments. Its return value contains `client` and `server` promises. `options` accepts callbacks and an optional timeout; bindings-level defaults run before options passed to this call.

## `useSession()`

```ts
const session = bindings.useSession();
```

Use this only when you need core control such as manual resources, `start()`, `stop()`, `setTTL()`, or `dispose()`. See [Session](/api/session) and [core-only usage](/guide/advanced/core-only).

## Lifecycle and errors

- Call all three methods in `setup()` or `<script setup>` after installing the bindings.
- Query and mutation resources created by the composables are disposed with the current Vue scope.
- Calling a composable before `app.use(bindings)` throws `Zero Vue bindings were not installed`.

## Related

- [Vue quickstart](/guide/adapters/vue)
- [Svelte API](/api/svelte)
- [Core and adapter-author APIs](/api)
