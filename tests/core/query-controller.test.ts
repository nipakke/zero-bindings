import { describe, expect, test } from "vite-plus/test";
import { type Zero } from "@rocicorp/zero";
import { DEFAULT_TTL_MS } from "@rocicorp/zero/bindings";
import { createTestZero, ttlSpyClient } from "../fixtures/zero.ts";
import { itemSchema as schema, itemZql as zql } from "../fixtures/item.ts";
import { rows } from "../fixtures/rows.ts";
import { QueryController } from "../../src/core/query-controller.ts";
import { createSource } from "../../src/core/source.ts";

/** A controller over a fresh local-only client and the plain `item` query. */
function testController() {
  const z = createTestZero({ schema, userID: "test" });

  return {
    z,
    controller: new QueryController({
      getClient: () => z,
      querySignal: createSource(() => zql.item),
    }),
  };
}

describe("QueryController lifecycle", () => {
  test("snapshots are identity-stable until a real transition", async () => {
    const { z, controller } = testController();
    expect(controller.getSnapshot()).toBe(controller.getSnapshot());
    controller.start();
    const settled = controller.getSnapshot();
    expect(controller.getSnapshot()).toBe(settled);
    await z.mutate.item.insert({ id: 1, name: "foo" });
    expect(rows(controller.getSnapshot().data)).toEqual([{ id: 1, name: "foo" }]);
    expect(controller.getSnapshot()).not.toBe(settled);
    expect(controller.getSnapshot()).toBe(controller.getSnapshot());
    controller.dispose();
  });

  test("start rematerializes after failure even when the key is unchanged", () => {
    const z = createTestZero({ schema, userID: "test" });
    let broken = true;

    const controller = new QueryController({
      getClient: () => z,
      querySignal: createSource(() => {
        if (broken) {
          throw new Error("signal boom");
        }

        return zql.item;
      }),
    });

    controller.start();
    expect(controller.getSnapshot().status).toBe("error");
    broken = false;
    controller.start();
    expect(controller.getSnapshot().status).not.toBe("error");
    controller.dispose();
  });

  test("no-client start yields unknown and later start materializes", async () => {
    const z = createTestZero({ schema, userID: "test" });
    let client: Zero<typeof schema> | undefined;

    const controller = new QueryController({
      getClient: () => client,
      querySignal: createSource(() => zql.item),
    });

    controller.start();
    expect(controller.getSnapshot().status).toBe("unknown");
    expect(controller.getSnapshot().data).toBeUndefined();
    client = z;
    controller.start();
    await z.mutate.item.insert({ id: 1, name: "foo" });
    expect(rows(controller.getSnapshot().data)).toEqual([{ id: 1, name: "foo" }]);
    controller.dispose();
  });

  test("disposed controllers neither notify nor restart", () => {
    const { controller } = testController();
    let notifications = 0;
    controller.subscribe(() => {
      notifications++;
    });
    controller.start();
    expect(notifications).toBeGreaterThan(0);
    controller.dispose();
    const settled = notifications;
    controller.start();
    controller.start();
    expect(notifications).toBe(settled);
    expect(controller.getSnapshot().status).toBe("disabled");
  });
});

describe("QueryController", () => {
  test("null signal yields disabled snapshot", () => {
    const z = createTestZero({ schema, userID: "test" });

    const controller = new QueryController({
      getClient: () => z,
      querySignal: createSource(() => null),
    });

    controller.start();
    expect(controller.getSnapshot().status).toBe("disabled");
    expect(controller.getSnapshot().data).toBeUndefined();
    expect(controller.getSnapshot().error).toBeUndefined();
    controller.dispose();
  });

  test("enabled:false yields disabled snapshot", () => {
    const z = createTestZero({ schema, userID: "test" });

    const controller = new QueryController({
      getClient: () => z,
      querySignal: createSource(() => zql.item),
      enabled: false,
    });

    controller.start();
    expect(controller.getSnapshot().status).toBe("disabled");
    controller.dispose();
  });

  test("stop retains the last snapshot", async () => {
    const { z, controller } = testController();
    controller.start();
    await z.mutate.item.insert({ id: 1, name: "foo" });
    expect(rows(controller.getSnapshot().data)).toEqual([{ id: 1, name: "foo" }]);
    controller.stop();
    expect(rows(controller.getSnapshot().data)).toEqual([{ id: 1, name: "foo" }]);
    await z.mutate.item.insert({ id: 2, name: "bar" });
    expect(rows(controller.getSnapshot().data)).toEqual([{ id: 1, name: "foo" }]);
    controller.dispose();
  });

  test("start rematerializes after stop", async () => {
    const { z, controller } = testController();
    controller.start();
    controller.stop();
    controller.start();
    await z.mutate.item.insert({ id: 1, name: "foo" });
    expect(rows(controller.getSnapshot().data)).toEqual([{ id: 1, name: "foo" }]);
    controller.dispose();
  });

  test("throwing signal settles into QuerySignalError", () => {
    const z = createTestZero({ schema, userID: "test" });

    const controller = new QueryController({
      getClient: () => z,
      querySignal: createSource(() => {
        throw new Error("signal boom");
      }),
    });

    controller.start();
    expect(controller.getSnapshot().status).toBe("error");
    expect(controller.getSnapshot().error).toMatchObject({
      type: "QuerySignalError",
      message: "signal boom",
    });
    controller.dispose();
  });

  test("materialize throw settles into MaterializationError", () => {
    const client = createTestZero({ schema, userID: "test" });

    // Only `materialize` is broken: the rest of the client stays real, so the
    // controller resolves the query through a genuine client.
    client.materialize = () => {
      throw new Error("materialize boom");
    };

    const controller = new QueryController({
      getClient: () => client,
      querySignal: createSource(() => zql.item),
    });

    expect(() => controller.start()).not.toThrow();
    expect(controller.getSnapshot().status).toBe("error");
    expect(controller.getSnapshot().error).toMatchObject({
      type: "MaterializationError",
      message: "materialize boom",
    });
    controller.dispose();
  });

  test("dispose is idempotent and start after dispose is a no-op", () => {
    const { controller } = testController();
    controller.start();
    controller.dispose();
    controller.dispose();
    controller.start();
    // Terminal teardown resets to disabled (unlike stop(), which retains).
    expect(controller.getSnapshot().status).toBe("disabled");
  });

  test("throwing input evaluation settles into an error snapshot", () => {
    const enabledBoom = new QueryController({
      getClient: () => createTestZero({ schema, userID: "test" }),
      querySignal: createSource(() => zql.item),
      enabled: createSource(() => {
        throw new Error("enabled boom");
      }),
    });

    expect(() => enabledBoom.start()).not.toThrow();
    expect(enabledBoom.getSnapshot()).toMatchObject({
      status: "error",
      error: { type: "QuerySignalError", message: "enabled boom" },
    });
    enabledBoom.dispose();

    const clientBoom = new QueryController({
      getClient: () => {
        throw new Error("client boom");
      },
      querySignal: createSource(() => zql.item),
    });

    expect(() => clientBoom.start()).not.toThrow();
    expect(clientBoom.getSnapshot()).toMatchObject({
      status: "error",
      error: { type: "MaterializationError", message: "client boom" },
    });
    clientBoom.dispose();
  });

  test("setTTL persists for the next materialization", () => {
    const { client, seen } = ttlSpyClient(createTestZero({ schema, userID: "test" }));

    const controller = new QueryController({
      getClient: () => client,
      querySignal: createSource(() => zql.item),
    });

    controller.start();
    controller.setTTL("10m");
    controller.start();
    expect(seen[seen.length - 1]).toBe("10m");
    controller.setTTL(undefined);
    controller.start();
    expect(seen[seen.length - 1]).toBe(DEFAULT_TTL_MS);
    controller.dispose();
  });
});
