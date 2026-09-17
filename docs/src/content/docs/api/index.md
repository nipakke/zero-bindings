---
title: API reference
---

Use the adapter API in application code. The framework-free exports are kept for custom adapters and host-neutral integrations.

## Vue

Import from `zero-bindings/vue`:

| Export                                        | Use                                                                |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `VueBindings.create()`                        | Create app bindings from Zero definitions and a client ref/getter. |
| `bindings.install(app)` / `app.use(bindings)` | Provide the bindings to the Vue app.                               |
| `bindings.useQuery()`                         | Read a reactive query result.                                      |
| `bindings.useMutation()`                      | Run a typed mutation and read its state.                           |
| `bindings.useSession()`                       | Escape hatch for core-level control.                               |

→ [Vue API](/api/vue)

## Svelte

Import from `zero-bindings/svelte`:

| Export                    | Use                                                              |
| ------------------------- | ---------------------------------------------------------------- |
| `SvelteBindings.create()` | Create bindings from Zero definitions and a client value/getter. |
| `ZeroProvider`            | Provide bindings to a component subtree.                         |
| `bindings.useQuery()`     | Read a reactive query result.                                    |
| `bindings.useMutation()`  | Run a typed mutation and read its state.                         |
| `bindings.useSession()`   | Escape hatch for core-level control.                             |

→ [Svelte API](/api/svelte)

## Shared result shapes

Queries expose `data`, `status`, and `error`. Mutations expose `mutate`, `reset`, `isPending`, `error`, `client`, and `server`. A query snapshot is exactly `{ data, status, error }` and a mutation snapshot `{ client, server }`: [query resources](/api/query-resource#errors) lists the error types, [mutation resources](/api/mutation-resource#snapshots) the leg statuses. The adapter pages document framework-specific ref/getter behavior.

## Core and adapter-author APIs

The root `zero-bindings` entry exports `createDefinitions`, `resolveGetter`, `createSource`, `toSource`, `ZeroSession`, `ObservableView`, `observableViewFactory`, `MutationError`, `MutationTimeoutError`, and the resource and snapshot types (`Source`, `SourceInput`, `ObservableResource`, `QueryResource`, `QuerySnapshot`, `QueryError`, `QueryStatus`, `MutationResource`, `MutationSnapshot`, `MutationLegSnapshot`, `MutationInfo`, `MutatorResult`, …). Use these when writing another adapter or integrating without a framework; normal Vue and Svelte application code does not need them.

→ [Core concepts](/guide/advanced/core-concepts)
→ [Core-only usage](/guide/advanced/core-only)
→ [Writing an adapter](/development/make-an-adapter)

### Detailed core contracts

- [Sources](/api/source)
- [Session](/api/session)
- [Query resources](/api/query-resource)
- [Mutation resources](/api/mutation-resource)
