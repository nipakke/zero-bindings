---
title: Vue
---

Use the Vue adapter when your app already has a Zero schema and client. The adapter provides `useQuery()` and `useMutation()` and cleans up their resources with the component scope.

## 1. Install

```sh
pnpm add zero-bindings @rocicorp/zero vue
```

## 2. Create bindings

Create one bindings instance for the app. Replace these imports with the modules that already define your Zero schema, registries, and client.

```ts title="src/zero.ts"
import { createDefinitions } from "zero-bindings";
import { VueBindings } from "zero-bindings/vue";
import { schema } from "./schema.ts";
import { queries, mutators } from "./registry.ts";
import { activeClient } from "./client.ts";

export const zero = VueBindings.create({
  definitions: createDefinitions({ schema, queries, mutators }),
  client: () => activeClient.value,
});
```

`activeClient` can be a Vue ref or a getter. Use a getter or ref when the client changes after login, logout, or tenant switching.

## 3. Install on the app

```ts title="src/main.ts"
import { createApp } from "vue";
import App from "./App.vue";
import { zero } from "./zero.ts";

createApp(App).use(zero).mount("#app");
```

`app.use(zero)` provides the bindings to every component below the app. Call the composables in `setup()` or `<script setup>`.

## 4. Run a query

```vue title="src/components/IssueList.vue"
<script setup lang="ts">
import { computed } from "vue";
import { zero } from "../zero.ts";

const props = defineProps<{ projectId: string | undefined }>();

const issues = zero.useQuery(
  (queries) =>
    queries.issue.filtered({
      projectId: props.projectId ?? "",
    }),
  () => ({ enabled: props.projectId !== undefined }),
);

const rows = computed(() => issues.data.value ?? []);
</script>

<template>
  <p v-if="issues.error.value">
    {{ issues.error.value.message }}
    <button type="button" @click="issues.error.value.retry()">Retry</button>
  </p>
  <p v-else-if="rows.length === 0">
    {{ issues.status.value === "unknown" ? "Loading…" : "No issues yet" }}
  </p>
  <ul v-else>
    <li v-for="issue in rows" :key="issue.id">{{ issue.title }}</li>
  </ul>
</template>
```

The query getter is reactive: reads of `props`, refs, and computeds inside it cause the query to be checked again. Pass options as a getter when `enabled` or `ttl` depends on reactive state.

If you do not use a query registry, pass a direct Zero query instead:

```ts
const issues = zero.useQuery(() => zql.issue);
```

### Query result

`data`, `status`, and `error` are refs; `error` carries the `retry()` that rematerializes. Full shapes, statuses, and `error.type` values: [query resources](/api/query-resource). Live queries can stay `unknown` while they stream — especially against a local-only client — so render existing `data` instead of waiting for `complete`.

## 5. Run a mutation

```vue
<script setup lang="ts">
import { ref } from "vue";
import { zero } from "../zero.ts";

const body = ref("");
const addComment = zero.useMutation((mutators) => mutators.comment.add, {
  onSuccess: () => {
    body.value = "";
  },
});

async function submit(): Promise<void> {
  await addComment.mutate({
    issueId: "issue-1",
    body: body.value,
  }).client;
}
</script>
```

`mutate()` takes the mutator's arguments. The result has `client` and `server` promises; `isPending.value`, `error.value`, `client.value`, and `server.value` expose the current state. Call `reset()` to return the result to `idle`.

## Client changes and SSR

Replacing the ref's value updates active queries in place:

```ts
activeClient.value = createClient(nextUserId);
```

Active queries rematerialize in place — same resources, same component code ([client replacement](/api/session#client-replacement)).

The Vue adapter has no SSR payload or hydration path. `install()` still builds and provides the session; because `app.onUnmount` does not run during SSR, dispose the session returned by `install(app)` at request teardown.

## Next

- [Vue API reference](/api/vue)
- [Svelte quickstart](/guide/adapters/svelte)
- [Development docs](/development)
