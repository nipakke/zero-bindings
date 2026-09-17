import { describe, expect, test } from "vite-plus/test";
import { type Zero } from "@rocicorp/zero";
import { createTestZero, pendingMutationClient } from "../fixtures/zero.ts";
import { itemMutators as mutators, itemSchema as schema } from "../fixtures/item.ts";
import {
  DisposedMutationError,
  MutationController,
  MutationError,
  type MutationInfo,
  MutationTimeoutError,
  type MutationOptions,
} from "../../src/core/mutation.ts";

type Settled = MutationInfo & { error?: unknown };

/** The request shape the real client accepts: a fake `mutate` forwards it untouched. */
type MutationRequest = Parameters<Zero<typeof schema>["mutate"]>[0];

/** Records the info payload of every settle in call order. */
function recorder() {
  const events: { phase: "success" | "error" | "settled"; info: Settled }[] = [];

  const options: MutationOptions = {
    onSuccess: (info) => {
      events.push({ phase: "success", info });
    },
    onError: (info) => {
      events.push({ phase: "error", info });
    },
    onSettled: (info) => {
      events.push({ phase: "settled", info });
    },
  };

  return { events, options };
}

/** Wait past the 20 ms timeouts above: real clock, this repo has no fake timers. */
async function afterTimeout(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 50);
  });
}

describe("MutationController", () => {
  test("idle snapshot, offline success legs, and info-payload callbacks", async () => {
    const z = createTestZero({ schema, userID: "test", mutators });
    const { events, options } = recorder();

    const resource = new MutationController(
      () => z,
      () => mutators.item.create,
      options,
    );

    expect(resource.getSnapshot().client.status).toBe("idle");
    expect(resource.getSnapshot().server.status).toBe("idle");
    const result = resource.mutate({ id: 1, name: "a" });
    expect(resource.getSnapshot().client.status).toBe("pending");
    const outcome = await result.client;
    expect(outcome.type).toBe("success");
    expect(resource.getSnapshot().client.status).toBe("success");
    // Local-only clients never settle a server leg.
    expect(resource.getSnapshot().server.status).toBe("unavailable");
    // `unavailable` is a snapshot status, not a settle: callbacks see the real
    // client leg only — its success fires before its settled.
    expect(events.map((event) => event.phase)).toEqual(["success", "settled"]);
    expect(events.map((event) => event.info.kind)).toEqual(["client", "client"]);
    const client = events[0]?.info;
    expect(client?.mutatorName).toBe("item.create");
    expect(client?.args).toEqual([{ id: 1, name: "a" }]);
    expect(client && "error" in client).toBe(false);
    resource.reset();
    expect(resource.getSnapshot().client.status).toBe("idle");
    resource.dispose();
  });

  test("mutator failure brands the settle error and reports it to onError", async () => {
    const z = createTestZero({ schema, userID: "test", mutators });
    let seen: unknown;
    let settled = 0;

    const resource = new MutationController(
      () => z,
      () => mutators.item.fail,
      {
        onError: (info) => {
          expect(info.mutatorName).toBe("item.fail");
          expect(info.kind).toBe("client");
          expect(info.args).toEqual([{ id: 1 }]);
          seen = info.error;
        },
        onSettled: () => {
          settled++;
        },
      },
    );

    const result = resource.mutate({ id: 1 });
    const outcome = await result.client;
    expect(outcome.type).toBe("error");
    expect(resource.getSnapshot().client.status).toBe("error");
    expect(seen).toBe(resource.getSnapshot().client.error);
    expect(seen).toBeInstanceOf(MutationError);
    // SAFETY: the `toBeInstanceOf` check just above is the evidence — the settle
    // error is a MutationError.
    const error = seen as Error;

    expect(error.message).toContain("mutator boom 1");
    expect(error.cause).toBe(outcome.type === "error" ? outcome : undefined);
    // A failed client leg means no server outcome is possible: the leg goes
    // terminal as `unavailable` in the snapshot, without a callback.
    expect(resource.getSnapshot().server.status).toBe("unavailable");
    expect(settled).toBe(1);
    resource.dispose();
  });

  test("dispose is idempotent and mutate after dispose throws", () => {
    const z = createTestZero({ schema, userID: "test", mutators });

    const resource = new MutationController(
      () => z,
      () => mutators.item.create,
    );

    resource.dispose();
    resource.dispose();
    expect(() => resource.mutate({ id: 1, name: "x" })).toThrow(DisposedMutationError);
  });

  test("dispose before settle ignores late callbacks and notifications", async () => {
    const z = createTestZero({ schema, userID: "test", mutators });
    let settled = 0;
    let notifications = 0;

    const resource = new MutationController(
      () => z,
      () => mutators.item.create,
      {
        onSettled: () => {
          settled++;
        },
      },
    );

    resource.subscribe(() => {
      notifications++;
    });
    const result = resource.mutate({ id: 1, name: "a" });
    resource.dispose();
    await result.client;
    // Disposal landed before the only settle this run can ever deliver: the
    // client settle, which arrived after disposal and was dropped.
    expect(settled).toBe(0);
    expect(notifications).toBe(1);
    expect(resource.getSnapshot().client.status).toBe("pending");
  });

  test("a resource torn down mid-flight never delivers its leaf callbacks", async () => {
    // Pinned delivery hole: callbacks live on the resource, so host teardown
    // (Vue `onScopeDispose`, a plain `dispose()`) drops every settle after it.
    const z = createTestZero({ schema, userID: "test", mutators });
    let settled = 0;

    const resource = new MutationController(
      () => z,
      () => mutators.item.create,
      {
        onSettled: () => {
          settled++;
        },
      },
    );

    const result = resource.mutate({ id: 1, name: "a" });
    resource.dispose();
    await result.client;
    expect(settled).toBe(0);
    expect(resource.getSnapshot().client.status).toBe("pending");
  });

  test("a second mutate swallows the first call's remaining settles", async () => {
    // Pinned delivery hole: one run per resource; the generation guard that
    // protects the snapshot also retires the first call's callbacks.
    let baseCalls = 0;
    const base = createTestZero({ schema, userID: "double", mutators });

    const client = new Proxy(base, {
      get(target, prop) {
        if (prop === "mutate") {
          return (request: MutationRequest) => {
            const result = target.mutate(request);

            baseCalls++;

            // Delay the first call's client settle past the second mutate.
            return baseCalls === 1
              ? {
                  client: Promise.resolve()
                    .then(() => result.client)
                    .then((r) => r),
                  server: result.server,
                }
              : result;
          };
        }

        // SAFETY: every key read off this fake is a declared client member.
        const value = target[prop as keyof typeof target];

        // A proxy trap is a dynamic boundary: forwarding binds methods to the
        // real client so its private state stays reachable.
        // oxlint-disable-next-line anti-slop/no-runtime-typeof
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    const settled: unknown[] = [];

    const resource = new MutationController(
      () => client,
      () => mutators.item.create,
      {
        // A resource callback sees every run; the info args say which call.
        onSettled: (info) => {
          settled.push(info.args[0]);
        },
      },
    );

    const r1 = resource.mutate({ id: 1, name: "a" });
    const r2 = resource.mutate({ id: 2, name: "b" });
    await Promise.all([r1.client, r2.client]);
    // Call 1's client settle arrived after call 2 took over the run and was
    // dropped; local-only server legs contribute nothing to delivery either way.
    expect(settled).toEqual([{ id: 2, name: "b" }]);
    resource.dispose();
  });

  test("a throwing callback is isolated from the settle path", async () => {
    const z = createTestZero({ schema, userID: "test", mutators });
    let later = 0;

    const resource = new MutationController(
      () => z,
      () => mutators.item.create,
      {
        onSuccess: () => {
          throw new Error("listener boom");
        },
        onSettled: () => {
          later++;
        },
      },
    );

    const result = resource.mutate({ id: 1, name: "a" });
    await expect(result.client).resolves.toMatchObject({ type: "success" });
    expect(resource.getSnapshot().client.status).toBe("success");
    expect(later).toBe(1);
    resource.dispose();
  });

  test("settled legs are immune to the timeout", async () => {
    const z = createTestZero({ schema, userID: "test", mutators });
    let errors = 0;

    const resource = new MutationController(
      () => z,
      () => mutators.item.create,
      {
        timeout: 20,
        onError: () => {
          errors++;
        },
      },
    );

    const result = resource.mutate({ id: 1, name: "a" });
    expect((await result.client).type).toBe("success");
    await afterTimeout();
    expect(errors).toBe(0);
    expect(resource.getSnapshot().client.status).toBe("success");
    resource.dispose();
  });

  test("a client leg still pending at timeout makes the server leg unavailable", async () => {
    const client = pendingMutationClient(createTestZero({ schema, userID: "test", mutators }));
    const kinds: string[] = [];
    let errors = 0;
    let settled = 0;

    const resource = new MutationController(
      () => client,
      () => mutators.item.create,
      {
        timeout: 20,
        onError: (info) => {
          errors++;
          kinds.push(info.kind);
          expect(info.mutatorName).toBe("item.create");
          expect(info.error).toBeInstanceOf(MutationTimeoutError);
        },
        onSettled: (info) => {
          settled++;
          kinds.push(info.kind);
        },
      },
    );

    resource.mutate({ id: 1, name: "a" });
    await afterTimeout();
    expect(resource.getSnapshot().client.status).toBe("error");
    expect(resource.getSnapshot().server.status).toBe("unavailable");
    expect(errors).toBe(1);
    expect(settled).toBe(1);
    expect(kinds).toEqual(["client", "client"]);
    resource.dispose();
  });

  test("mutate().server resolves with the client outcome when no server can ack", async () => {
    // Zero's real server leg of a local-only client never settles; the swap
    // makes the returned object match the terminal `unavailable` snapshot.
    const z = createTestZero({ schema, userID: "test", mutators });

    const resource = new MutationController(
      () => z,
      () => mutators.item.create,
    );

    const result = resource.mutate({ id: 1, name: "a" });
    expect(result.server).toBe(result.client);
    expect((await result.server).type).toBe("success");
    resource.dispose();
  });

  test("a configured but disconnected server never times out the server leg", async () => {
    // Offline mutations queue in Zero — its server promise cannot settle any
    // faster than a serverless one's. Only `server`/`connection` are faked;
    // `mutate` runs on the real local-only client, so the client leg is genuine.
    const base = createTestZero({ schema, userID: "offline", mutators });

    const client = new Proxy(base, {
      get(target, prop) {
        if (prop === "server") {
          return {};
        }

        if (prop === "connection") {
          return { state: { current: { name: "connecting", reason: "" } } };
        }

        // SAFETY: every key read off this fake is a declared client member.
        const value = target[prop as keyof typeof target];

        // A proxy trap is a dynamic boundary: forwarding binds methods to the
        // real client so its private state stays reachable.
        // oxlint-disable-next-line anti-slop/no-runtime-typeof
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    let errors = 0;
    const kinds: string[] = [];

    const resource = new MutationController(
      () => client,
      () => mutators.item.create,
      {
        timeout: 20,
        onError: (info) => {
          errors++;
          kinds.push(`error:${info.kind}`);
        },
        onSettled: (info) => {
          kinds.push(`settled:${info.kind}`);
        },
      },
    );

    const result = resource.mutate({ id: 1, name: "a" });
    expect((await result.client).type).toBe("success");
    expect(result.server).toBe(result.client);
    await afterTimeout();
    expect(errors).toBe(0);
    expect(resource.getSnapshot().client.status).toBe("success");
    expect(resource.getSnapshot().server.status).toBe("unavailable");
    expect(kinds).toEqual(["settled:client"]);
    resource.dispose();
  });

  test("the liveness decision is taken at call time, not tracked per run", async () => {
    // Run 1 is tracked live; after the fake drops the connection, run 2 must
    // start terminal — a reconnect can no longer resurrect the retired leg.
    let connected = true;
    const base = createTestZero({ schema, userID: "flip", mutators });

    const client = new Proxy(base, {
      get(target, prop) {
        if (prop === "server") {
          return {};
        }

        if (prop === "connection") {
          return {
            state: {
              current: connected
                ? { name: "connected" }
                : { name: "disconnected", reason: "offline" },
            },
          };
        }

        if (prop === "mutate") {
          return () => ({
            client: new Promise<never>(() => {}),
            server: new Promise<never>(() => {}),
          });
        }

        // SAFETY: every key read off this fake is a declared client member.
        const value = target[prop as keyof typeof target];

        // A proxy trap is a dynamic boundary: forwarding binds methods to the
        // real client so its private state stays reachable.
        // oxlint-disable-next-line anti-slop/no-runtime-typeof
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    const resource = new MutationController(
      () => client,
      () => mutators.item.create,
      {
        timeout: 0,
      },
    );

    const r1 = resource.mutate({ id: 1, name: "a" });
    expect(resource.getSnapshot().server.status).toBe("pending");
    expect(r1.server).not.toBe(r1.client);
    connected = false;
    const r2 = resource.mutate({ id: 2, name: "b" });
    expect(resource.getSnapshot().server.status).toBe("unavailable");
    expect(r2.server).toBe(r2.client);
    resource.dispose();
  });
});
