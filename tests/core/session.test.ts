import { describe, expect, test, vi } from "vite-plus/test";
import { type TTL, type Zero } from "@rocicorp/zero";
import { DEFAULT_TTL_MS } from "@rocicorp/zero/bindings";
import { createTestZero, pendingMutationClient, ttlSpyClient } from "../fixtures/zero.ts";
import {
  itemMutators as registryMutators,
  itemSchema as schema,
  itemZql as zql,
} from "../fixtures/item.ts";
import { rows } from "../fixtures/rows.ts";
import { signal } from "../fixtures/source.ts";
import { createDefinitions } from "../../src/core/definitions.ts";
import {
  ClientUnavailableError,
  DisposedMutationError,
  MutationTimeoutError,
} from "../../src/core/mutation.ts";
import { ZeroSession } from "../../src/core/session.ts";
import { createSource } from "../../src/core/source.ts";

/** A local-only client named `test` and the session that owns it. */
function testSession() {
  const z = createTestZero({ schema, userID: "test" });

  return { z, session: ZeroSession.create(createDefinitions({ schema }), { client: z }) };
}

describe("ZeroSession", () => {
  test("source-driven client attachment and replacement preserve resource identity", async () => {
    let client: Zero<typeof schema> | undefined;
    const { source: clientSource, fire } = signal(() => client);
    const session = ZeroSession.create(createDefinitions({ schema }), { client: clientSource });
    const resource = session.createQuery(() => zql.item);
    resource.start();
    expect(resource.getSnapshot().status).toBe("unknown");
    client = createTestZero({ schema, userID: "test" });
    await client.mutate.item.insert({ id: 1, name: "first" });
    fire();
    expect(rows(resource.getSnapshot().data)).toEqual([{ id: 1, name: "first" }]);
    const replacement = createTestZero({ schema, userID: "test" });
    await replacement.mutate.item.insert({ id: 2, name: "second" });
    client = replacement;
    fire();
    expect(rows(resource.getSnapshot().data)).toEqual([{ id: 2, name: "second" }]);
    session.dispose();
  });

  test("late attachment, same-client no-op, swap, and dispose", async () => {
    const session = ZeroSession.create(createDefinitions({ schema }), { client: undefined });
    expect(session.client).toBeUndefined();
    const resource = session.createQuery(() => zql.item);
    resource.start();
    expect(resource.getSnapshot().status).toBe("unknown");

    const first = createTestZero({ schema, userID: "test" });
    session.setClient(first);
    expect(session.client).toBe(first);
    await first.mutate.item.insert({ id: 1, name: "a" });
    expect(rows(resource.getSnapshot().data)).toEqual([{ id: 1, name: "a" }]);

    const snapshot = resource.getSnapshot();
    session.setClient(first);
    expect(resource.getSnapshot()).toBe(snapshot);

    const second = createTestZero({ schema, userID: "test" });
    await second.mutate.item.insert({ id: 2, name: "b" });
    session.setClient(second);
    expect(rows(resource.getSnapshot().data)).toEqual([{ id: 2, name: "b" }]);

    session.dispose();
    expect(resource.getSnapshot().status).toBe("disabled");
    resource.start();
    expect(resource.getSnapshot().status).toBe("disabled");
  });

  test("inactive resources stay inactive across client replacement", async () => {
    const session = ZeroSession.create(createDefinitions({ schema }), { client: undefined });
    const resource = session.createQuery(() => zql.item);
    resource.start();
    resource.stop();
    const first = createTestZero({ schema, userID: "test" });
    await first.mutate.item.insert({ id: 1, name: "a" });
    session.setClient(first);
    expect(resource.active).toBe(false);
    expect(resource.getSnapshot().data).toBeUndefined();
    session.dispose();
  });

  test("active replacement keeps the resource with no disabled flash or stale rows", async () => {
    const session = ZeroSession.create(createDefinitions({ schema }), { client: undefined });
    const resource = session.createQuery(() => zql.item);
    resource.start();
    const statuses: string[] = [];
    resource.subscribe(() => {
      statuses.push(resource.getSnapshot().status);
    });
    const first = createTestZero({ schema, userID: "test" });
    await first.mutate.item.insert({ id: 1, name: "a" });
    session.setClient(first);
    expect(rows(resource.getSnapshot().data)).toEqual([{ id: 1, name: "a" }]);
    const second = createTestZero({ schema, userID: "test" });
    await second.mutate.item.insert({ id: 2, name: "b" });
    statuses.length = 0;
    session.setClient(second);
    expect(rows(resource.getSnapshot().data)).toEqual([{ id: 2, name: "b" }]);
    expect(statuses).not.toContain("disabled");
    session.dispose();
  });

  test("detachment to undefined settles into the stable unknown snapshot", async () => {
    const { z: first, session } = testSession();
    const resource = session.createQuery(() => zql.item);
    resource.start();
    await first.mutate.item.insert({ id: 1, name: "a" });
    expect(rows(resource.getSnapshot().data)).toEqual([{ id: 1, name: "a" }]);
    session.setClient(undefined);
    expect(resource.getSnapshot().status).toBe("unknown");
    expect(resource.getSnapshot().data).toBeUndefined();
    session.dispose();
  });

  test("listener-triggered replacement fans out safely", async () => {
    const { z: first, session } = testSession();
    const resource = session.createQuery(() => zql.item);
    resource.start();
    await first.mutate.item.insert({ id: 1, name: "a" });
    expect(rows(resource.getSnapshot().data)).toEqual([{ id: 1, name: "a" }]);
    const second = createTestZero({ schema, userID: "test" });
    await second.mutate.item.insert({ id: 2, name: "b" });
    let swapped = false;
    resource.subscribe(() => {
      if (!swapped) {
        swapped = true;
        session.setClient(second);
      }
    });
    await first.mutate.item.insert({ id: 3, name: "c" });
    expect(swapped).toBe(true);
    expect(rows(resource.getSnapshot().data)).toEqual([{ id: 2, name: "b" }]);
    session.dispose();
  });

  test("query source changes rematerialize only when the key changes", () => {
    let query = zql.item.where("id", 1);
    const { source, fire } = signal(() => () => query);
    const { session } = testSession();
    const resource = session.createQuery(source);
    resource.start();
    const before = resource.getSnapshot();
    fire();
    expect(resource.getSnapshot()).toBe(before);
    query = zql.item.where("id", 2);
    fire();
    expect(resource.getSnapshot()).not.toBe(before);
    session.dispose();
  });

  test("a stopped resource is not restarted by source changes", () => {
    let query = zql.item.where("id", 1);
    let enabled = true;
    const { source: querySource, fire: notifyQuery } = signal(() => () => query);
    const { source: enabledSource, fire: notifyEnabled } = signal(() => enabled);
    const { session } = testSession();
    const resource = session.createQuery(querySource, { enabled: enabledSource });
    resource.start();
    resource.stop();
    const snapshot = resource.getSnapshot();
    query = zql.item.where("id", 2);
    notifyQuery();
    expect(resource.active).toBe(false);
    expect(resource.getSnapshot()).toBe(snapshot);
    enabled = false;
    notifyEnabled();
    expect(resource.active).toBe(false);
    session.dispose();
  });

  test("enabled sources are forwarded", () => {
    let enabled = false;
    const { source: enabledSource, fire: notifyEnabled } = signal(() => enabled);
    const { session } = testSession();
    const resource = session.createQuery(() => zql.item, { enabled: enabledSource });
    resource.start();
    expect(resource.getSnapshot().status).toBe("disabled");
    enabled = true;
    notifyEnabled();
    expect(resource.getSnapshot().status).not.toBe("disabled");
    session.dispose();
  });

  test("ttl source changes reach the next materialization", () => {
    let ttl: TTL | undefined = "10m";
    const { source: ttlSource, fire } = signal(() => ttl);
    const { client, seen } = ttlSpyClient(createTestZero({ schema, userID: "test" }));
    const session = ZeroSession.create(createDefinitions({ schema }), { client });
    const resource = session.createQuery(() => zql.item, { ttl: ttlSource });
    resource.start();
    expect(seen[seen.length - 1]).toBe("10m");
    ttl = undefined;
    fire();
    resource.start();
    expect(seen[seen.length - 1]).toBe(DEFAULT_TTL_MS);
    session.dispose();
  });

  test("registry query and mutator getters resolve", async () => {
    const client = createTestZero({ schema, userID: "registry", mutators: registryMutators });

    const definitions = createDefinitions({
      schema,
      queries: { all: () => zql.item },
      mutators: { create: () => registryMutators.item.create },
    });

    const session = ZeroSession.create(definitions, { client });
    const query = session.createQuery("all");
    const mutation = session.createMutation<typeof registryMutators.item.create>("create");
    const result = mutation.mutate({ id: 4, name: "registry" });
    await result.client;
    expect(query.getSnapshot().status).not.toBe("error");
    session.dispose();
  });

  test("createMutation without a client throws ClientUnavailableError on mutate", () => {
    const session = ZeroSession.create(createDefinitions({ schema }), { client: undefined });
    const resource = session.createMutation(() => () => ({ mutator: "item", args: [] }));
    expect(() => resource.mutate()).toThrow(ClientUnavailableError);
    resource.dispose();
    session.dispose();
  });

  test("session disposal disposes owned mutation resources", () => {
    const { session } = testSession();
    const resource = session.createMutation(() => () => ({ mutator: "item", args: [] }));
    session.dispose();
    expect(() => resource.mutate()).toThrow(DisposedMutationError);
  });

  test("session mutation defaults fire before each resource's own callbacks", async () => {
    const client = createTestZero({ schema, userID: "defaults", mutators: registryMutators });

    const definitions = createDefinitions({
      schema,
      mutators: { create: () => registryMutators.item.create },
    });

    const order: string[] = [];

    const session = ZeroSession.create(definitions, {
      client,
      mutations: {
        onSuccess: () => {
          order.push("default:success");
        },
        onSettled: () => {
          order.push("default:settled");
        },
      },
    });

    const resource = session.createMutation<typeof registryMutators.item.create>("create", {
      onSuccess: () => {
        order.push("resource:success");
      },
    });

    await resource.mutate({ id: 1, name: "a" }).client;
    // Defaults compose beneath the resource: each real settle runs the default
    // callback first. The local-only server leg never fires, so nothing leads.
    expect(order).toEqual(["default:success", "resource:success", "default:settled"]);
    session.dispose();
  });

  test("the timeout default flows from the session and yields to the resource", async () => {
    const base = createTestZero({ schema, userID: "default-timeout", mutators: registryMutators });
    // Every leg stays pending forever: only the timeout can settle it.
    const never = pendingMutationClient(base);

    const definitions = createDefinitions({
      schema,
      mutators: { create: () => registryMutators.item.create },
    });

    const slowDefaults = ZeroSession.create(definitions, {
      client: never,
      mutations: { timeout: 5_000 },
    });

    // Await the timeout transitions themselves, not a sleep: the 5 s default
    // cannot have expired by the time both 20 ms runs have settled as errors.
    const fastResource = slowDefaults.createMutation<typeof registryMutators.item.create>(
      "create",
      {
        timeout: 20,
      },
    );

    const inheritsSlow = slowDefaults.createMutation<typeof registryMutators.item.create>("create");

    const quickDefaults = ZeroSession.create(definitions, {
      client: never,
      mutations: { timeout: 20 },
    });

    const inheritsDefault =
      quickDefaults.createMutation<typeof registryMutators.item.create>("create");

    fastResource.mutate({ id: 1, name: "a" });
    inheritsSlow.mutate({ id: 2, name: "b" });
    inheritsDefault.mutate({ id: 3, name: "c" });
    await vi.waitFor(() => {
      expect(fastResource.getSnapshot().client.error).toBeInstanceOf(MutationTimeoutError);
      expect(inheritsDefault.getSnapshot().client.error).toBeInstanceOf(MutationTimeoutError);
    });
    expect(inheritsSlow.getSnapshot().client.status).toBe("pending");
    expect(inheritsSlow.getSnapshot().server.status).toBe("pending");
    slowDefaults.dispose();
    quickDefaults.dispose();
  });

  test("resource onDispose fires once on disposal and never after unsubscribe", () => {
    const { session } = testSession();
    const resource = session.createQuery(() => zql.item);
    resource.start();
    let fired = 0;
    resource.onDispose(() => {
      fired++;
    });
    const removed = session.createQuery(() => zql.item);

    const unsubscribe = removed.onDispose(() => {
      fired++;
    });

    unsubscribe();
    removed.dispose();
    expect(fired).toBe(0);
    resource.dispose();
    resource.dispose();
    expect(fired).toBe(1);
    session.dispose();
  });

  test("session disposal stops source reactions", () => {
    let unsubscriptions = 0;

    const source = createSource(
      () => () => zql.item,
      () => () => {
        unsubscriptions++;
      },
    );

    const { session } = testSession();
    const resource = session.createQuery(source);
    resource.start();
    session.dispose();
    expect(unsubscriptions).toBe(1);
  });

  test("input subscriptions follow start, stop, and disposal", () => {
    let subscriptions = 0;
    let unsubscriptions = 0;

    const source = createSource(
      () => () => zql.item,
      (_listener) => {
        subscriptions++;

        return () => {
          unsubscriptions++;
        };
      },
    );

    const { session } = testSession();
    const resource = session.createQuery(source);
    expect(subscriptions).toBe(0);
    resource.start();
    expect(subscriptions).toBe(1);
    resource.stop();
    expect(unsubscriptions).toBe(1);
    resource.dispose();
    expect(unsubscriptions).toBe(1);
    session.dispose();
  });

  test("a throwing client source settles active queries as error", () => {
    const client = createTestZero({ schema, userID: "test" });
    let broken = false;

    const { source: clientSource, fire } = signal<Zero<typeof schema> | undefined>(() => {
      if (broken) {
        throw new Error("client exploded");
      }

      return client;
    });

    const session = ZeroSession.create(createDefinitions({ schema }), { client: clientSource });
    const resource = session.createQuery(() => zql.item);
    resource.start();
    expect(resource.getSnapshot().status).not.toBe("error");

    broken = true;
    fire();
    expect(session.client).toBeUndefined();
    expect(resource.getSnapshot().status).toBe("error");
    expect(resource.getSnapshot().error?.message).toBe("client exploded");

    broken = false;
    fire();
    expect(session.client).toBe(client);
    expect(resource.getSnapshot().status).not.toBe("error");
    session.dispose();
  });

  test("a client source that throws during construction leaves the session detached", () => {
    const session = ZeroSession.create(createDefinitions({ schema }), {
      client: {
        get: () => {
          throw new Error("early");
        },
        subscribe: () => () => {},
      },
    });

    expect(session.client).toBeUndefined();
    const resource = session.createQuery(() => zql.item);
    resource.start();
    expect(resource.getSnapshot().status).toBe("error");
    expect(resource.getSnapshot().error?.message).toBe("early");
    session.dispose();
  });
});
