<script setup lang="ts">
import { computed, ref } from "vue";
import { zero } from "./zero/app-bindings.ts";
import { DEMO_USERS, activeClient, activeUserID, switchUser } from "./zero/workspace.ts";

const onlyOpen = ref(false);

const title = ref("");

const todos = zero.useQuery((queries) => queries.todo.list({ onlyOpen: onlyOpen.value }));

const addTodo = zero.useMutation((mutators) => mutators.todo.add);

const setDone = zero.useMutation((mutators) => mutators.todo.setDone);

const removeTodo = zero.useMutation((mutators) => mutators.todo.remove);

const rows = computed(() => todos.data.value ?? []);

const activeName = computed(
  () => DEMO_USERS.find((user) => user.id === activeUserID.value)?.name ?? activeUserID.value,
);

function selectUser(event: Event): void {
  if (event.target instanceof HTMLSelectElement) {
    switchUser(event.target.value);
  }
}

function submit(): void {
  const text = title.value.trim();

  if (text === "" || addTodo.isPending.value) {
    return;
  }

  addTodo.reset();
  void addTodo.mutate({ id: crypto.randomUUID(), title: text }).client;
  title.value = "";
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

<template>
  <div class="app">
    <header>
      <p class="eyebrow">zero-bindings · Vue playground</p>
      <h1>A tiny todo list</h1>
      <p class="muted">
        Local-only Zero client (<code>cacheURL: null</code>). The query stays
        <code>unknown</code> without a server, but local rows are still usable.
      </p>
    </header>

    <main class="panel">
      <div class="toolbar">
        <label for="identity">Signed in as</label>
        <select id="identity" :value="activeUserID" @change="selectUser">
          <option v-for="user in DEMO_USERS" :key="user.id" :value="user.id">
            {{ user.name }}
          </option>
        </select>
        <span class="muted"
          >client: <code>{{ activeClient.userID }}</code> · {{ activeName }}</span
        >
      </div>

      <form class="add-form" @submit.prevent="submit">
        <input v-model="title" aria-label="New todo title" placeholder="What needs doing?" />
        <button class="primary" type="submit" :disabled="addTodo.isPending.value">
          {{ addTodo.isPending.value ? "Adding…" : "Add todo" }}
        </button>
      </form>

      <div class="toolbar">
        <label class="check-label">
          <input v-model="onlyOpen" type="checkbox" />
          Show open todos only
        </label>
        <span class="muted"
          >query: <code>{{ todos.status.value }}</code></span
        >
      </div>

      <p v-if="todos.error.value" class="message error">
        Query error: {{ todos.error.value.message }}
      </p>
      <p v-if="addTodo.error.value" class="message error">
        Add failed: {{ String(addTodo.error.value) }}
      </p>
      <p v-if="setDone.error.value" class="message error">
        Update failed: {{ String(setDone.error.value) }}
      </p>
      <p v-if="removeTodo.error.value" class="message error">
        Remove failed: {{ String(removeTodo.error.value) }}
      </p>
      <p v-if="rows.length === 0" class="message muted">
        {{
          todos.status.value === "unknown" ? "Loading local todos…" : "No todos match this filter."
        }}
      </p>

      <ul v-if="rows.length > 0" class="todo-list">
        <li v-for="todo in rows" :key="todo.id" class="todo-row">
          <label class="check-label">
            <input :checked="todo.done" type="checkbox" @change="toggle(todo)" />
            <span :class="{ done: todo.done }">{{ todo.title }}</span>
          </label>
          <button class="remove" type="button" @click="remove(todo)">Remove</button>
        </li>
      </ul>
    </main>
  </div>
</template>
