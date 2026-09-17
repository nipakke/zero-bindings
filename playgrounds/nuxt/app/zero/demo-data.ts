import type { AppClient } from "./client.ts";

export const DEMO_USERS = [
  { id: "ada", name: "Ada" },
  { id: "grace", name: "Grace" },
] as const;

/** Seed rows per identity: each entry is `[title, done]`. */
const SEED_TODOS = {
  ada: [
    ["Read the Zero bindings guide", false],
    ["Try the open-only filter", false],
    ["Toggle a todo", true],
  ],
  grace: [
    ["Design the todo schema", true],
    ["Switch between users", false],
  ],
} as const satisfies Record<string, readonly (readonly [string, boolean])[]>;

/** Seeds one local-only browser client, awaiting every write before handoff. */
export function seedTodos(client: AppClient, userID: string): Promise<void> {
  const now = Date.now();
  const rows = Object.entries(SEED_TODOS).find(([id]) => id === userID)?.[1] ?? [];

  return (async () => {
    for (const [index, [title, done]] of rows.entries()) {
      await client.mutate.todo.insert({
        id: `${userID}-${index}`,
        title,
        done,
        createdAt: now + index,
      });
    }
  })();
}
