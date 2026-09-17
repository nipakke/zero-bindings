---
title: Svelte
---

Use the Svelte adapter when your app already has a Zero schema and client. A `ZeroProvider` supplies the session to the tree, and `useQuery()` / `useMutation()` expose reactive values in components.

## 1. Install

```sh
pnpm add zero-bindings @rocicorp/zero svelte
```

## 2. Create bindings

Create one bindings instance from the Zero values your app already owns. Put this in a `.svelte.ts` file when `activeClient` uses runes state.

```ts title="src/lib/zero/bindings.svelte.ts"
import { createDefinitions } from "zero-bindings";
import { SvelteBindings } from "zero-bindings/svelte";
import { schema } from "./schema.ts";
import { queries, mutators } from "./registry.ts";
import { activeClient } from "./client.svelte.ts";

export const bindings = SvelteBindings.create({
  definitions: createDefinitions({ schema, queries, mutators }),
  client: () => activeClient,
});
```

Use a getter when the client changes after login, logout, or tenant switching. A plain client value is read once.

## 3. Add the provider

Put the provider above components that use the bindings. In SvelteKit, the root layout is the usual location:

```svelte title="src/routes/+layout.svelte"
<script lang="ts">
  import { ZeroProvider } from "zero-bindings/svelte";
  import { bindings } from "$lib/zero/bindings.svelte";

  let { children } = $props();
</script>

<ZeroProvider {bindings}>
  {@render children()}
</ZeroProvider>
```

Call the hooks during component initialization, or inside a `.svelte.ts` function called during initialization.

## 4. Run a query

```svelte title="src/routes/issues/+page.svelte"
<script lang="ts">
  import { bindings } from "$lib/zero/bindings.svelte";

  let { projectId } = $props<{ projectId: string | undefined }>();

  const issues = bindings.useQuery(
    (queries) =>
      queries.issue.filtered({
        projectId: projectId ?? "",
      }),
    () => ({ enabled: projectId !== undefined }),
  );
</script>

{#if issues.error}
  <p>{issues.error.message}</p>
  <button type="button" onclick={() => issues.error?.retry()}>Retry</button>
{:else if issues.data?.length}
  <ul>
    {#each issues.data as issue (issue.id)}
      <li>{issue.title}</li>
    {/each}
  </ul>
{:else if issues.status === "unknown"}
  <p>Loading…</p>
{:else}
  <p>No issues yet</p>
{/if}
```

The query getter is reactive: reads of props, `$state`, and `$derived` values inside it cause the query to be checked again. Pass options as a getter when `enabled` or `ttl` depends on reactive state.

If you do not use a query registry, pass a direct Zero query instead:

```ts
const issues = bindings.useQuery(() => zql.issue);
```

### Query result

`data`, `status`, and `error` are plain getters over one snapshot; `error` carries the `retry()` that rematerializes. Full shapes, statuses, and `error.type` values: [query resources](/api/query-resource). Live queries can stay `unknown` while they stream — especially against a local-only client — so render existing `data` instead of waiting for `complete`.

## 5. Run a mutation

```svelte
<script lang="ts">
  import { bindings } from "$lib/zero/bindings.svelte";

  let body = $state("");
  const addComment = bindings.useMutation((mutators) => mutators.comment.add);

  async function submit(): Promise<void> {
    await addComment.mutate({
      issueId: "issue-1",
      body,
    }).client;
  }
</script>
```

`mutate()` takes the mutator's arguments. The result has `client` and `server` promises; `isPending`, `error`, `client`, and `server` expose the current state. Call `reset()` to return the result to `idle`.

## Client changes and SSR

Update the state read by the client getter when the user changes:

```ts
activeClient = createClient(nextUserId);
```

Active queries rematerialize in place — same resources, same component code ([client replacement](/api/session#client-replacement)).

The provider is safe in SSR. Effects do not run during SSR, so queries start when the browser mounts. Create client state and bindings per request when rendering multiple users on the server.

## Next

- [Svelte API reference](/api/svelte)
- [Vue quickstart](/guide/adapters/vue)
- [Development docs](/development)
