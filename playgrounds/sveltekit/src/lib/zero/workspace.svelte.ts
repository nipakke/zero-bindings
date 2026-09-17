import { createContext, tick } from "svelte";
import { createClient, seedTodos, type AppClient } from "./client.ts";

export const USERS = [
  { id: "ada", name: "Ada" },
  { id: "grace", name: "Grace" },
] as const;

/** The per-tree state the bindings and pages read: who is signed in, and their client. */
export type Workspace = {
  readonly userID: string;
  readonly client: AppClient | undefined;
  readonly switchUser: (userID: string) => void;
};

/**
 * One workspace per component tree — per request on the server, per page in the
 * browser. Every mutable value (the active user, the client cell) lives here in
 * the tree, never at module scope, so two concurrent SSR renders never share a
 * client or an active user.
 *
 * The cell starts `undefined` and the client is built in an effect. Effects
 * never run during SSR, so a server render starts no Zero client: the session
 * stays detached and queries report `disabled`. The browser render hydrates
 * that same detached state, then the effect builds the client and the session
 * picks it up.
 */
export function createWorkspace(): Workspace {
  let userID = $state<string>(USERS[0].id);
  let client = $state.raw<AppClient | undefined>(undefined);

  $effect(() => {
    const next = createClient(userID);
    const nextSeed = seedTodos(next);
    client = next;

    return () => void retire(next, nextSeed);
  });

  return {
    get userID() {
      return userID;
    },
    get client() {
      return client;
    },
    switchUser(next: string): void {
      if (next !== userID) {
        userID = next;
      }
    },
  };
}

export const [getWorkspace, setWorkspace] = createContext<Workspace>();

/**
 * Close a superseded client once it is safe: `tick` waits out the session's
 * client-source effect, so no active query still points at this client, and
 * the seed settles first, so no write is refused as `Zero is closed`.
 *
 * The close is not silent, and the noise is expected: a local-only client's
 * mutation `server` legs never settle, so `close()` rejects every one of
 * them and Zero logs a `Mutator "..." error on server` per mutation this
 * client made. The live session has already moved on.
 */
async function retire(client: AppClient, seed: Promise<void>): Promise<void> {
  await tick();

  try {
    await seed;
  } finally {
    await client.close();
  }
}
