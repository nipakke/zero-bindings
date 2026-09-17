import { Zero } from "@rocicorp/zero";
import { mutators } from "./mutators.ts";
import { schema, type AppSchema } from "./schema.ts";

/**
 * A local-only Zero client: `cacheURL: null` plus an in-memory store means
 * every query and mutation is served in the browser, no zero-cache process
 * required. Each identity gets its own client — and its own store — so
 * swapping clients is observable in the data, not just in the status line.
 */
export function createClient(userID: string): AppClient {
  return new Zero<AppSchema>({
    cacheURL: null,
    userID,
    schema,
    kvStore: "mem",
    mutators,
  });
}

export type AppClient = Zero<AppSchema>;

/** Seed rows per identity: each entry is `[title, done]`, in insertion order. */
interface SeedTitles {
  readonly [userID: string]: ReadonlyArray<readonly [title: string, done: boolean]>;
}

const SEED_TITLES: SeedTitles = {
  ada: [
    ["Read AGENTS.md", false],
    ["Wrap the root layout in ZeroProvider", false],
    ["Toggle a todo and watch the legs settle", false],
  ],
  grace: [
    ["Design the COBOL compiler", true],
    ["Name the compiler", false],
  ],
};

/**
 * Seeds one client, one write at a time. The caller keeps the promise: an
 * outgoing client must not be closed before its seed settles, or the
 * remaining writes are rejected with `Zero is closed`.
 */
export function seedTodos(client: AppClient): Promise<void> {
  const now = Date.now();
  const userID = client.userID ?? "anon";
  const rows = SEED_TITLES[userID] ?? [];

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
