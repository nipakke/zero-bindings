<script lang="ts">
  import type { Snippet } from "svelte";
  import type { AnySvelteBindings } from "./create-bindings.ts"

  let {
    bindings,
    children,
  }: {
    // Any bindings instance — the structural type keeps the provider free of
    // the session's five type parameters; the hooks resolve the session
    // through the same instance, which owns the context key.
    bindings: AnySvelteBindings
    children: Snippet;
  } = $props();

  // Construction happens in the tree: `setContext` is init-only, so this
  // component — not module scope — is where a host's session is built.
  // svelte-ignore state_referenced_locally — capturing the prop is the point:
  // `setContext` is init-only, so the session is built exactly once per tree.
  const session = bindings.provide();



  // Effects never run during SSR, so a server render registers no disposal;
  // it also starts no resources, which is why the session is inert there.
  $effect(() => () => session.dispose());
</script>

{@render children()}
