/**
 * Host-neutrality check: core is consumed through the root entry with no Vue
 * import anywhere — the plain `mirror()` sink plays the adapter-mirror role.
 * This is the invariant the deleted Effector adapter implicitly carried.
 */
import { describe, expect, test } from "vite-plus/test";
import { type Zero } from "@rocicorp/zero";
import {
  itemMutators as mutators,
  itemSchema as schema,
  itemZql as zql,
} from "../fixtures/item.ts";
import { rows } from "../fixtures/rows.ts";
import { mirror } from "../fixtures/fake-adapter.ts";
import { createTestZero } from "../fixtures/zero.ts";
import { signal } from "../fixtures/source.ts";
import {
  createDefinitions,
  ZeroSession,
  type MutationSnapshot,
  createSource,
} from "../../src/index.ts";

describe("host neutrality (plain-JS sink)", () => {
  test("a plain mirror observes query snapshots through a source-driven client", async () => {
    let client: Zero<typeof schema> | undefined;
    const { source: clientSource, fire } = signal(() => client);
    const session = ZeroSession.create(createDefinitions({ schema }), { client: clientSource });
    const resource = session.createQuery(() => zql.item);
    resource.start();
    const live = mirror(resource);
    expect(live.seen[0]?.status).toBe("unknown");
    client = createTestZero({ schema, userID: "plain" });
    fire();
    await client.mutate.item.insert({ id: 1, name: "a" });
    // Local-only clients stream without ever completing: the rows arrive,
    // the status stays "unknown" — the sink must observe exactly that.
    expect(live.seen.at(-1)?.status).toBe("unknown");
    expect(rows(live.seen.at(-1)?.data)).toEqual([{ id: 1, name: "a" }]);
    live.stop();
    session.dispose();
  });

  test("a plain mirror observes mutation leg snapshots", async () => {
    const client = createTestZero({ schema, userID: "plain", mutators });

    const session = ZeroSession.create(createDefinitions({ schema, mutators }), {
      client: createSource(() => client),
    });

    const resource = session.createMutation(() => mutators.item.create);
    const live = mirror<MutationSnapshot>(resource);
    const result = resource.mutate({ id: 2, name: "b" });
    expect(live.seen.at(-1)?.client.status).toBe("pending");
    expect((await result.client).type).toBe("success");
    expect(live.seen.at(-1)?.client.status).toBe("success");
    // Local-only client: the server leg is terminal from the start.
    expect(live.seen[1]?.server.status).toBe("unavailable");
    expect(live.seen.at(-1)?.client.error).toBeUndefined();
    live.stop();
    session.dispose();
  });
});
