import { describe, expect, test } from "vite-plus/test";
import { mount, tick } from "svelte";
import { defineQueriesWithType, defineQueryWithType, type Zero } from "@rocicorp/zero";
import { createTestZero } from "../../fixtures/zero.ts";
import {
  itemMutators as customMutators,
  itemSchema as schema,
  itemZql as zql,
} from "../../fixtures/item.ts";
import { rows, type RowSnapshot } from "../../fixtures/rows.ts";
import { mountBindings, state } from "../../fixtures/svelte.svelte.ts";
import { createDefinitions } from "../../../src/core/definitions.ts";
import { SvelteBindings } from "../../../src/adapters/svelte/index.ts";
import type { UseMutationResult } from "../../../src/adapters/svelte/mirror.svelte.ts";
import {
  expectClientReplacement,
  expectMutationMirrorLifecycle,
  expectSessionIdentity,
  type MutationMirrorView,
  type QueryView,
} from "../../fixtures/adapter-suite.ts";

type CreateMutator = typeof customMutators.item.create;

/** The mirror's reads as Svelte exposes them: every field is a plain getter. */
const mirrorView = (mirror: UseMutationResult<CreateMutator>): MutationMirrorView => ({
  isPending: () => mirror.isPending,
  client: () => mirror.client,
  server: () => mirror.server,
  // SAFETY: the mirror surfaces the failure the mutator threw; the specs assert it is an Error.
  error: () => mirror.error as Error | undefined,
  mutate: (args) => mirror.mutate(args),
  reset: () => mirror.reset(),
});

const customQueries = defineQueriesWithType<typeof schema>()({
  item: {
    byId: defineQueryWithType<typeof schema>()(({ args }: { args: { id: number } }) =>
      zql.item.where("id", args.id).one(),
    ),
  },
});

describe("Svelte bindings", () => {
  test("provided bindings deliver rows and dispose resources on unmount", async () => {
    const z = createTestZero({ schema, userID: "provided" });

    const bindings = SvelteBindings.create({
      definitions: createDefinitions({ schema }),
      client: z,
    });

    let status: (() => string) | undefined;
    let data: (() => RowSnapshot) | undefined;

    const { unmount } = mountBindings(bindings, () => {
      const result = bindings.useQuery(() => zql.item);
      status = () => result.status;
      data = () => rows(result.data);
    });

    // The mirror's effect starts the resource on the first flush.
    await tick();
    expect(status?.()).not.toBe("disabled");

    await z.mutate.item.insert({ id: 1, name: "foo" });
    expect(data?.()).toEqual([{ id: 1, name: "foo" }]);

    unmount();
    expect(status?.()).toBe("disabled");
  });

  test("reactive client replacement rematerializes in place", async () => {
    const client = state<Zero<typeof schema> | undefined>(undefined);

    const bindings = SvelteBindings.create({
      definitions: createDefinitions({ schema }),
      client: () => client.current,
    });

    let view: QueryView | undefined;

    const { unmount } = mountBindings(bindings, () => {
      const result = bindings.useQuery(() => zql.item);
      view = {
        status: () => result.status,
        data: () => rows(result.data),
        setClient: (next) => {
          client.current = next;
        },
        flush: () => tick(),
      };
    });

    await expectClientReplacement(view!);
    unmount();
  });

  test("reactive query getters rematerialize", async () => {
    const z = createTestZero({ schema, userID: "signal" });
    const id = state(1);

    const bindings = SvelteBindings.create({
      definitions: createDefinitions({ schema }),
      client: z,
    });

    let data: (() => RowSnapshot) | undefined;

    const { unmount } = mountBindings(bindings, () => {
      const result = bindings.useQuery(() => zql.item.where("id", id.current));
      data = () => rows(result.data);
    });

    await tick();
    await z.mutate.item.insert({ id: 1, name: "one" });
    await z.mutate.item.insert({ id: 2, name: "two" });
    expect(data?.()).toEqual([{ id: 1, name: "one" }]);
    id.current = 2;
    await tick();
    expect(data?.()).toEqual([{ id: 2, name: "two" }]);
    unmount();
  });

  test("registry queries resolve through the bindings", async () => {
    const z = createTestZero({ schema, userID: "registry" });

    const bindings = SvelteBindings.create({
      definitions: createDefinitions({ schema, queries: customQueries }),
      client: z,
    });

    let data: (() => RowSnapshot) | undefined;

    const { unmount } = mountBindings(bindings, () => {
      const result = bindings.useQuery((queries) => queries.item.byId({ id: 2 }));
      data = () => rows(result.data);
    });

    await tick();
    await z.mutate.item.insert({ id: 1, name: "one" });
    await z.mutate.item.insert({ id: 2, name: "two" });
    expect(data?.()).toEqual({ id: 2, name: "two" });
    unmount();
  });

  test("enabled source toggles a bound query resource", async () => {
    const z = createTestZero({ schema, userID: "enabled" });
    const enabled = state(false);

    const bindings = SvelteBindings.create({
      definitions: createDefinitions({ schema }),
      client: z,
    });

    let status: (() => string) | undefined;

    const { unmount } = mountBindings(bindings, () => {
      const result = bindings.useQuery(() => zql.item, { enabled: () => enabled.current });
      status = () => result.status;
    });

    await tick();
    expect(status?.()).toBe("disabled");

    enabled.current = true;
    await tick();
    expect(status?.()).not.toBe("disabled");
    unmount();
  });

  test("useMutation mirrors a session mutation resource", async () => {
    const z = createTestZero({ schema, userID: "mutation", mutators: customMutators });

    const bindings = SvelteBindings.create({
      definitions: createDefinitions({ schema, mutators: customMutators }),
      client: z,
    });

    let successes = 0;
    let mutate: ((args: { id: number; name: string }) => Promise<string>) | undefined;
    let legStatus: (() => string) | undefined;

    const { unmount } = mountBindings(bindings, () => {
      const result = bindings.useMutation((mutators) => mutators.item.create, {
        onSuccess: () => {
          successes++;
        },
      });

      mutate = async (args) => (await result.mutate(args).client).type;
      legStatus = () => result.client.status;
    });

    expect(await mutate?.({ id: 9, name: "mutation" })).toBe("success");
    expect(legStatus?.()).toBe("success");
    expect(successes).toBe(1);
    unmount();
  });

  test("bindings-level mutation defaults fire before the resource's own", async () => {
    const z = createTestZero({ schema, userID: "bindings-defaults", mutators: customMutators });
    const order: string[] = [];

    const bindings = SvelteBindings.create({
      definitions: createDefinitions({ schema, mutators: customMutators }),
      client: z,
      mutations: {
        onSuccess: () => {
          order.push("default");
        },
      },
    });

    let leg: Promise<unknown> | undefined;

    const { unmount } = mountBindings(bindings, () => {
      const result = bindings.useMutation((mutators) => mutators.item.create, {
        onSuccess: () => {
          order.push("resource");
        },
      });

      leg = result.mutate({ id: 9, name: "defaults" }).client;
    });

    await leg;
    expect(order).toEqual(["default", "resource"]);
    unmount();
  });

  test("mutation mirror exposes pending state, both legs, error, and reset", async () => {
    const z = createTestZero({ schema, userID: "mirror", mutators: customMutators });

    const bindings = SvelteBindings.create({
      definitions: createDefinitions({ schema, mutators: customMutators }),
      client: z,
    });

    let ok!: UseMutationResult<CreateMutator>;
    let failing!: UseMutationResult<CreateMutator>;

    const { unmount } = mountBindings(bindings, () => {
      ok = bindings.useMutation((mutators) => mutators.item.create);
      failing = bindings.useMutation((mutators) => mutators.item.boom);
    });

    await tick();

    await expectMutationMirrorLifecycle(mirrorView(ok), mirrorView(failing));
    unmount();
  });

  test("query errors are decorated with a working retry", async () => {
    const z = createTestZero({ schema, userID: "retry" });

    const bindings = SvelteBindings.create({
      definitions: createDefinitions({ schema }),
      client: z,
    });

    const broken = state(true);
    let status: (() => string) | undefined;
    let error: (() => string | undefined) | undefined;
    let retry: (() => void) | undefined;

    const { unmount } = mountBindings(bindings, () => {
      const result = bindings.useQuery(() => {
        if (broken.current) {
          throw new Error("bad query");
        }

        return zql.item;
      });

      status = () => result.status;
      error = () => result.error?.message;
      retry = () => result.error?.retry();
    });

    await tick();
    expect(status?.()).toBe("error");
    expect(error?.()).toBe("bad query");

    broken.current = false;
    retry?.();
    expect(status?.()).not.toBe("error");
    unmount();
  });

  test("hooks outside a provider tree throw a clear error", async () => {
    const bindings = SvelteBindings.create({
      definitions: createDefinitions({ schema }),
      client: createTestZero({ schema, userID: "unprovided" }),
    });

    const errors: string[] = [];

    function Orphan() {
      for (const call of [() => bindings.useQuery(() => zql.item), () => bindings.useSession()]) {
        try {
          call();
        } catch (error) {
          // SAFETY: the bindings throw `new Error`, so the caught value carries a `message`.
          errors.push((error as Error).message);
        }
      }

      return {};
    }

    // SAFETY: `Orphan` is a template-less probe (as in the fixture's `Probe`); `mount` accepts
    // any function at runtime, but its parameter type wants a Svelte signature this stub omits.
    mount(Orphan as never, { target: document.createElement("div"), props: {} });
    await tick();
    expect(errors).toHaveLength(2);

    for (const message of errors) {
      expect(message).toMatch(/not provided/);
    }
  });

  test("useSession returns the provided session with its resource factory", async () => {
    const z = createTestZero({ schema, userID: "session" });

    const bindings = SvelteBindings.create({
      definitions: createDefinitions({ schema }),
      client: z,
    });

    const seen = { same: false, clientMatches: false, active: false };
    let injected: object | undefined;

    const { value, unmount } = mountBindings(bindings, (b) => {
      const session = b.useSession();
      const resource = session.createQuery(() => zql.item);
      resource.start();
      injected = session;
      seen.same = session === b.useSession();
      seen.clientMatches = session.client === z;
      seen.active = resource.active;

      return session;
    });

    expectSessionIdentity({ installed: value, injected, ...seen });
    unmount();
  });

  test("unmounting the provider disposes the session and its resources", async () => {
    const z = createTestZero({ schema, userID: "tree" });

    const bindings = SvelteBindings.create({
      definitions: createDefinitions({ schema }),
      client: z,
    });

    let status: (() => string) | undefined;

    const { unmount } = mountBindings(bindings, () => {
      const result = bindings.useQuery(() => zql.item);
      status = () => result.status;
    });

    await tick();
    expect(status?.()).not.toBe("disabled");
    unmount();
    // The provider's destructor disposes the session, which drains the query.
    expect(status?.()).toBe("disabled");
  });
});
