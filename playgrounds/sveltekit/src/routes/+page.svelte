<script lang="ts">
  import { zero } from "$lib/zero/bindings.svelte.ts";
  import { getWorkspace, USERS } from "$lib/zero/workspace.svelte.ts";

  const workspace = getWorkspace();

  let onlyOpen = $state(false);

  let title = $state("");

  const todos = zero.useQuery((queries) => queries.todo.list({ onlyOpen }));

  const addTodo = zero.useMutation((mutators) => mutators.todo.add);

  const setDone = zero.useMutation((mutators) => mutators.todo.setDone);

  const removeTodo = zero.useMutation((mutators) => mutators.todo.remove);

  const rows = $derived(todos.data ?? []);

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    const text = title.trim();

    if (text === "" || addTodo.isPending) {
      return;
    }

    addTodo.reset();
    void addTodo.mutate({ id: crypto.randomUUID(), title: text }).client;
    title = "";
  }

  function toggle(todo: { id: string; done: boolean }): void {
    setDone.reset();
    void setDone.mutate({ id: todo.id, done: !todo.done }).client;
  }

  function remove(todo: { id: string }): void {
    removeTodo.reset();
    void removeTodo.mutate({ id: todo.id }).client;
  }
</script>

<header>
  <p class="eyebrow">zero-bindings · SvelteKit playground</p>
  <h1>A tiny todo list</h1>
  <p class="muted">
    Local-only Zero client (<code>cacheURL: null</code>). The query stays
    <code>unknown</code> without a server, but local rows are still usable.
  </p>
</header>

<section class="panel">
  <div class="toolbar">
    <label for="identity">Signed in as</label>
    <select
      id="identity"
      value={workspace.userID}
      onchange={(event) => workspace.switchUser((event.currentTarget as HTMLSelectElement).value)}
    >
      {#each USERS as user (user.id)}
        <option value={user.id}>{user.name}</option>
      {/each}
    </select>
    <span class="muted">client: <code>{workspace.userID}</code></span>
  </div>

  <form class="add-form" onsubmit={submit}>
    <input bind:value={title} aria-label="New todo title" placeholder="What needs doing?" />
    <button class="primary" type="submit" disabled={addTodo.isPending || title.trim() === ""}>
      {addTodo.isPending ? "Adding…" : "Add todo"}
    </button>
  </form>

  <div class="toolbar">
    <label class="check-label">
      <input bind:checked={onlyOpen} type="checkbox" />
      Show open todos only
    </label>
    <span class="muted">query: <code>{todos.status}</code></span>
  </div>

  {#if todos.error}
    <p class="message error">Query error: {todos.error.message}</p>
  {/if}
  {#if addTodo.error}
    <p class="message error">Add failed: {String(addTodo.error)}</p>
  {/if}
  {#if setDone.error}
    <p class="message error">Update failed: {String(setDone.error)}</p>
  {/if}
  {#if removeTodo.error}
    <p class="message error">Remove failed: {String(removeTodo.error)}</p>
  {/if}

  {#if rows.length === 0}
    <p class="message empty">
      {todos.status === "disabled"
        ? "No client — queries are disabled."
        : todos.status === "unknown"
          ? "Loading local todos…"
          : "No todos match this filter."}
    </p>
  {:else}
    <ul class="todo-list">
      {#each rows as todo (todo.id)}
        <li class="todo-row">
          <label class="check-label">
            <input type="checkbox" checked={todo.done} onchange={() => toggle(todo)} />
            <span class:done={todo.done}>{todo.title}</span>
          </label>
          <button class="remove" type="button" onclick={() => remove(todo)}>Remove</button>
        </li>
      {/each}
    </ul>
  {/if}
</section>
