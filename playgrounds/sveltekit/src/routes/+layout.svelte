<script lang="ts">
  import { ZeroProvider } from "zero-bindings/svelte";
  import "./layout.css";
  import favicon from "$lib/assets/favicon.svg";
  import { zero } from "$lib/zero/bindings.svelte";
  import { createWorkspace, setWorkspace } from "$lib/zero/workspace.svelte";

  let { children } = $props();

  // One workspace — client cell + active user — per tree, built during
  // initialization. On the server that is one per request; the client itself
  // is created only in the browser (inside the workspace's effect). The
  // module-scope `zero` bindings read this tree's cell through context.
  setWorkspace(createWorkspace());
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<ZeroProvider bindings={zero}>
  <main class="shell">
    {@render children()}
  </main>
</ZeroProvider>
