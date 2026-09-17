import { nextTick, ref, shallowRef } from "vue";
import { createClient, type AppClient } from "./client.ts";

export const DEMO_USERS = [
  { id: "ada", name: "Ada" },
  { id: "grace", name: "Grace" },
] as const;

type SeedRow = readonly [title: string, done: boolean];

const SEED_ROWS = {
  ada: [
    ["Read the Zero guide", false],
    ["Try the open-only filter", false],
    ["Toggle a todo", true],
  ],
  grace: [
    ["Design the compiler", true],
    ["Name the compiler", false],
  ],
} as const satisfies Record<string, readonly SeedRow[]>;

function seedTodos(client: AppClient): Promise<void> {
  const userID = client.userID ?? "anon";
  const rows = Object.entries(SEED_ROWS).find(([id]) => id === userID)?.[1] ?? [];
  const createdAt = Date.now();

  return (async () => {
    for (const [index, [title, done]] of rows.entries()) {
      await client.mutate.todo.insert({
        id: `${userID}-${index}`,
        title,
        done,
        createdAt: createdAt + index,
      });
    }
  })();
}

export const activeUserID = ref<string>(DEMO_USERS[0].id);

export const activeClient = shallowRef<AppClient>(createClient(activeUserID.value));

let activeSeed = seedTodos(activeClient.value);

async function retire(client: AppClient, seed: Promise<void>): Promise<void> {
  await nextTick();

  try {
    await seed;
  } finally {
    await client.close();
  }
}

export function switchUser(userID: string): void {
  if (!DEMO_USERS.some((user) => user.id === userID) || userID === activeUserID.value) {
    return;
  }

  const outgoing = activeClient.value;
  const outgoingSeed = activeSeed;
  activeUserID.value = userID;
  activeClient.value = createClient(userID);
  activeSeed = seedTodos(activeClient.value);
  void retire(outgoing, outgoingSeed);
}
