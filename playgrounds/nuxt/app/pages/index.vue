<script setup lang="ts">
import { computed, ref } from "vue";

const { $zero, $zeroServerData, $zeroUsers, $zeroUserID, $switchZeroUser } = useNuxtApp();

const cacheConfigured = $zeroServerData;

const userID = computed(() => $zeroUserID.value);

const onlyOpen = ref(false);

const title = ref("");

const {
  data: todos,
  status,
  error,
} = $zero.useQuery((queries) => queries.todo.list({ onlyOpen: onlyOpen.value }), {
  // No cache URL means there is nothing for Nuxt SSR to run; the browser
  // still starts the same live query after hydration.
  enabled: () => import.meta.client || cacheConfigured,
});

const add = $zero.useMutation((mutators) => mutators.todo.add);

const setDone = $zero.useMutation((mutators) => mutators.todo.setDone);

const remove = $zero.useMutation((mutators) => mutators.todo.remove);

const addTodo = (): void => {
  const text = title.value.trim();

  if (text === "" || add.isPending.value) {
    return;
  }

  add.mutate({ id: crypto.randomUUID(), title: text });
  title.value = "";
};

const toggleTodo = (id: string, done: boolean): void => {
  setDone.mutate({ id, done });
};
</script>

<template>
  <main>
    <h1>zero-bindings · Nuxt todos</h1>

    <p class="mode">
      <strong>{{ cacheConfigured ? "cache-backed SSR" : "local-only browser client" }}</strong>
      · live query: <strong>{{ status }}</strong>
    </p>
    <p class="hint">
      {{
        cacheConfigured
          ? "A configured zero cache can render rows into the server payload."
          : "Set NUXT_PUBLIC_ZERO_CACHE_URL to enable experimental payload SSR."
      }}
    </p>

    <div class="users" aria-label="Demo identity">
      <span>signed in as</span>
      <button
        v-for="user in $zeroUsers"
        :key="user.id"
        type="button"
        :class="{ active: user.id === userID }"
        @click="$switchZeroUser(user.id)"
      >
        {{ user.name }}
      </button>
    </div>

    <form @submit.prevent="addTodo">
      <input v-model="title" placeholder="Add a todo" aria-label="Todo title" />
      <button type="submit" :disabled="add.isPending.value">Add</button>
    </form>

    <label class="filter">
      <input v-model="onlyOpen" type="checkbox" />
      Show open todos only
    </label>

    <p v-if="error" class="error">{{ error.message }}</p>
    <p v-else-if="todos === undefined" class="loading">Loading todos…</p>
    <p v-else-if="todos.length === 0" class="empty">No todos match this filter.</p>

    <ul v-else>
      <li v-for="todo in todos" :key="todo.id">
        <input
          type="checkbox"
          :checked="todo.done"
          :aria-label="`Mark ${todo.title} ${todo.done ? 'open' : 'done'}`"
          @change="toggleTodo(todo.id, !todo.done)"
        />
        <span :class="{ done: todo.done }">{{ todo.title }}</span>
        <button type="button" class="remove" @click="remove.mutate({ id: todo.id })">remove</button>
      </li>
    </ul>

    <p v-if="add.error.value" class="error">{{ String(add.error.value) }}</p>
    <p v-else-if="setDone.error.value" class="error">{{ String(setDone.error.value) }}</p>
    <p v-else-if="remove.error.value" class="error">{{ String(remove.error.value) }}</p>
  </main>
</template>

<style scoped>
main {
  font-family: system-ui, sans-serif;
  margin: 0 auto;
  max-width: 40rem;
  padding: 2rem 1rem;
}

h1 {
  font-size: 1.25rem;
}

.mode,
.hint,
.users,
.filter {
  font-size: 0.85rem;
  line-height: 1.5;
}

.hint,
.empty,
.loading {
  color: #666;
}

.users {
  align-items: center;
  display: flex;
  gap: 0.5rem;
  margin: 1rem 0;
}

.users button.active {
  font-weight: 700;
}

form {
  display: flex;
  gap: 0.5rem;
  margin: 1rem 0 0.75rem;
}

input:not([type="checkbox"]) {
  flex: 1;
  padding: 0.4rem 0.5rem;
}

.filter {
  display: block;
  margin-bottom: 1rem;
}

ul {
  list-style: none;
  padding: 0;
}

li {
  align-items: center;
  border-top: 1px solid #ddd;
  display: flex;
  gap: 0.75rem;
  padding: 0.5rem 0;
}

li span {
  flex: 1;
}

.done {
  color: #999;
  text-decoration: line-through;
}

.error {
  color: #b00;
  font-size: 0.85rem;
}
</style>
