import { describe, expect, test } from "vite-plus/test";
import { nextTick, ref, shallowRef } from "vue";
import { defineQueriesWithType, defineQueryWithType, type Zero } from "@rocicorp/zero";
import { createTestZero } from "../../fixtures/zero.ts";
import {
  itemMutators as customMutators,
  itemSchema as schema,
  itemZql as zql,
} from "../../fixtures/item.ts";
import { rows, type RowSnapshot } from "../../fixtures/rows.ts";
import { mountApp, mountBindings } from "../../fixtures/vue.ts";
import { createDefinitions } from "../../../src/core/definitions.ts";
import { VueBindings } from "../../../src/adapters/vue/index.ts";
import type { UseMutationResult } from "../../../src/adapters/vue/mirror.ts";
import {
  expectClientReplacement,
  expectMutationMirrorLifecycle,
  expectSessionIdentity,
  type MutationMirrorView,
  type QueryView,
} from "../../fixtures/adapter-suite.ts";

type CreateMutator = typeof customMutators.item.create;

/** The mirror's reads as Vue exposes them: every field is a ref. */
const mirrorView = (mirror: UseMutationResult<CreateMutator>): MutationMirrorView => ({
  isPending: () => mirror.isPending.value,
  client: () => mirror.client.value,
  server: () => mirror.server.value,
  // SAFETY: the mirror surfaces the failure the mutator threw; the specs assert it is an Error.
  error: () => mirror.error.value as Error | undefined,
  mutate: (args) => mirror.mutate(args),
  reset: () => mirror.reset(),
});

describe("Vue bindings", () => {
  test("installed bindings deliver rows and dispose resources on unmount", async () => {
    const z = createTestZero({ schema, userID: "installed" });
    const client = shallowRef<Zero<typeof schema> | undefined>(z);
    const bindings = VueBindings.create({ definitions: createDefinitions({ schema }), client });
    let status: (() => string) | undefined;
    let data: (() => RowSnapshot) | undefined;

    const { unmount } = mountBindings(bindings, () => {
      const result = bindings.useQuery(() => zql.item);
      status = () => result.status.value;
      data = () => rows(result.data.value);
    });

    expect(status?.()).not.toBe("disabled");

    await z.mutate.item.insert({ id: 1, name: "foo" });
    expect(data?.()).toEqual([{ id: 1, name: "foo" }]);

    unmount();
    expect(status?.()).toBe("disabled");
  });

  test("reactive client replacement rematerializes in place", async () => {
    const client = ref<Zero<typeof schema> | undefined>();
    const bindings = VueBindings.create({ definitions: createDefinitions({ schema }), client });
    let view: QueryView | undefined;

    const { unmount } = mountBindings(bindings, () => {
      const result = bindings.useQuery(() => zql.item);
      view = {
        status: () => result.status.value,
        data: () => rows(result.data.value),
        setClient: (next) => {
          client.value = next;
        },
        flush: () => nextTick(),
      };
    });

    await expectClientReplacement(view!);
    unmount();
  });

  test("reactive query getters rematerialize", async () => {
    const z = createTestZero({ schema, userID: "signal" });
    const id = ref(1);
    const bindings = VueBindings.create({ definitions: createDefinitions({ schema }), client: z });
    let data: (() => RowSnapshot) | undefined;

    const { unmount } = mountBindings(bindings, () => {
      const result = bindings.useQuery(() => zql.item.where("id", id.value));
      data = () => rows(result.data.value);
    });

    await z.mutate.item.insert({ id: 1, name: "one" });
    await z.mutate.item.insert({ id: 2, name: "two" });
    expect(data?.()).toEqual([{ id: 1, name: "one" }]);
    id.value = 2;
    await nextTick();
    expect(data?.()).toEqual([{ id: 2, name: "two" }]);
    unmount();
  });

  test("enabled source toggles a bound query resource", async () => {
    const z = createTestZero({ schema, userID: "enabled" });
    const enabled = ref(false);
    const bindings = VueBindings.create({ definitions: createDefinitions({ schema }), client: z });
    let status: (() => string) | undefined;

    const { unmount } = mountBindings(bindings, () => {
      const result = bindings.useQuery(() => zql.item, { enabled });
      status = () => result.status.value;
    });

    expect(status?.()).toBe("disabled");

    enabled.value = true;
    await nextTick();
    expect(status?.()).not.toBe("disabled");
    unmount();
  });

  test("useMutation mirrors a session mutation resource", async () => {
    const z = createTestZero({ schema, userID: "mutation", mutators: customMutators });

    const bindings = VueBindings.create({
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
      legStatus = () => result.client.value.status;
    });

    expect(await mutate?.({ id: 9, name: "mutation" })).toBe("success");
    expect(legStatus?.()).toBe("success");
    expect(successes).toBe(1);
    unmount();
  });

  test("bindings-level mutation defaults fire before the resource's own", async () => {
    const z = createTestZero({ schema, userID: "bindings-defaults", mutators: customMutators });
    const order: string[] = [];

    const bindings = VueBindings.create({
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

    const bindings = VueBindings.create({
      definitions: createDefinitions({ schema, mutators: customMutators }),
      client: z,
    });

    let ok!: UseMutationResult<CreateMutator>;
    let failing!: UseMutationResult<CreateMutator>;

    const { unmount } = mountBindings(bindings, () => {
      ok = bindings.useMutation((mutators) => mutators.item.create);
      failing = bindings.useMutation((mutators) => mutators.item.boom);
    });

    await expectMutationMirrorLifecycle(mirrorView(ok), mirrorView(failing));
    unmount();
  });

  test("query errors are decorated with a working retry", async () => {
    const z = createTestZero({ schema, userID: "retry" });
    const bindings = VueBindings.create({ definitions: createDefinitions({ schema }), client: z });
    let broken = true;
    let status: (() => string) | undefined;
    let error: (() => string | undefined) | undefined;
    let retry: (() => void) | undefined;

    const { unmount } = mountBindings(bindings, () => {
      const result = bindings.useQuery(() => {
        if (broken) {
          throw new Error("bad query");
        }

        return zql.item;
      });

      status = () => result.status.value;
      error = () => result.error.value?.message;
      retry = () => result.error.value?.retry();
    });

    expect(status?.()).toBe("error");
    expect(error?.()).toBe("bad query");

    broken = false;
    retry?.();
    expect(status?.()).not.toBe("error");
    unmount();
  });

  test("composables outside an installed app throw a clear error", () => {
    const bindings = VueBindings.create({
      definitions: createDefinitions({ schema }),
      client: createTestZero({ schema, userID: "uninstalled" }),
    });

    const errors: string[] = [];

    const { unmount } = mountApp(() => {
      for (const call of [() => bindings.useQuery(() => zql.item), () => bindings.useSession()]) {
        try {
          call();
        } catch (error) {
          // SAFETY: the bindings throw `new Error`, so the caught value carries a `message`.
          errors.push((error as Error).message);
        }
      }
    });

    expect(errors).toHaveLength(2);

    for (const message of errors) {
      expect(message).toMatch(/not installed/);
    }

    unmount();
  });

  test("useSession returns the installed session with its resource factory", async () => {
    const z = createTestZero({ schema, userID: "session" });
    const bindings = VueBindings.create({ definitions: createDefinitions({ schema }), client: z });
    const seen = { same: false, clientMatches: false, active: false };
    let injected: object | undefined;

    const { session: installed, unmount } = mountBindings(bindings, () => {
      const session = bindings.useSession();
      const resource = session.createQuery(() => zql.item);
      resource.start();
      injected = session;
      seen.same = session === bindings.useSession();
      seen.clientMatches = session.client === z;
      seen.active = resource.active;
    });

    expectSessionIdentity({ installed, injected, ...seen });
    unmount();
  });

  test("a throwing client getter settles queries as error and recovers", async () => {
    const z = createTestZero({ schema, userID: "client-source-error" });
    const broken = ref(false);

    const bindings = VueBindings.create({
      definitions: createDefinitions({ schema }),
      client: () => {
        if (broken.value) {
          throw new Error("client exploded");
        }

        return z;
      },
    });

    let status: (() => string) | undefined;
    let error: (() => string | undefined) | undefined;

    const { unmount } = mountBindings(bindings, () => {
      const result = bindings.useQuery(() => zql.item);
      status = () => result.status.value;
      error = () => result.error.value?.message;
    });

    expect(status?.()).not.toBe("error");

    broken.value = true;
    await nextTick();
    expect(status?.()).toBe("error");
    expect(error?.()).toBe("client exploded");

    broken.value = false;
    await nextTick();
    expect(status?.()).not.toBe("error");
    unmount();
  });

  test("one bindings instance installs independent sessions on two apps", async () => {
    const client = shallowRef<Zero<typeof schema> | undefined>(
      createTestZero({ schema, userID: "both-apps" }),
    );

    const bindings = VueBindings.create({ definitions: createDefinitions({ schema }), client });
    let dataA: (() => RowSnapshot) | undefined;
    let dataB: (() => RowSnapshot) | undefined;
    let statusA: (() => string) | undefined;
    let sessionA: object | undefined;
    let sessionB: object | undefined;

    const { unmount: unmountA } = mountBindings(bindings, () => {
      const result = bindings.useQuery(() => zql.item);
      dataA = () => rows(result.data.value);
      statusA = () => result.status.value;
      sessionA = bindings.useSession();
    });

    const { unmount: unmountB } = mountBindings(bindings, () => {
      const result = bindings.useQuery(() => zql.item);
      dataB = () => rows(result.data.value);
      sessionB = bindings.useSession();
    });

    // One bindings instance, one client source, one session per host: the hosts
    // read the same rows through distinct sessions.
    await client.value!.mutate.item.insert({ id: 1, name: "both" });
    expect(dataA?.()).toEqual([{ id: 1, name: "both" }]);
    expect(dataB?.()).toEqual([{ id: 1, name: "both" }]);
    expect(sessionA).not.toBe(sessionB);

    // Each host owns its session: unmounting one ends only its own resources.
    unmountA();
    expect(statusA?.()).toBe("disabled");
    await client.value!.mutate.item.insert({ id: 2, name: "still-b" });
    // The unmounted host's mirror is torn down with its component scope; the
    // other host's session is untouched.
    expect(dataA?.()).toBeUndefined();
    expect(dataB?.()).toEqual([
      { id: 1, name: "both" },
      { id: 2, name: "still-b" },
    ]);

    unmountB();
  });

  test("two bindings instances installed on one app keep independent clients", async () => {
    const a = createTestZero({ schema, userID: "bindings-a" });
    const b = createTestZero({ schema, userID: "bindings-b" });
    const clientA = shallowRef<Zero<typeof schema> | undefined>(a);
    const clientB = shallowRef<Zero<typeof schema> | undefined>(b);

    const bindingsA = VueBindings.create({
      definitions: createDefinitions({ schema }),
      client: clientA,
    });

    const bindingsB = VueBindings.create({
      definitions: createDefinitions({ schema }),
      client: clientB,
    });

    let dataA: (() => RowSnapshot) | undefined;
    let dataB: (() => RowSnapshot) | undefined;
    let sessionA: object | undefined;
    let sessionB: object | undefined;

    const { unmount } = mountApp(
      () => {
        const resultA = bindingsA.useQuery(() => zql.item);
        const resultB = bindingsB.useQuery(() => zql.item);
        dataA = () => rows(resultA.data.value);
        dataB = () => rows(resultB.data.value);
        sessionA = bindingsA.useSession();
        sessionB = bindingsB.useSession();
      },
      (app) => {
        bindingsA.install(app);
        bindingsB.install(app);
      },
    );

    await a.mutate.item.insert({ id: 1, name: "a" });
    await b.mutate.item.insert({ id: 2, name: "b" });
    expect(dataA?.()).toEqual([{ id: 1, name: "a" }]);
    expect(dataB?.()).toEqual([{ id: 2, name: "b" }]);
    expect(sessionA).not.toBe(sessionB);

    const replacement = createTestZero({ schema, userID: "bindings-a-replacement" });
    await replacement.mutate.item.insert({ id: 3, name: "a-replacement" });
    clientA.value = replacement;
    await nextTick();
    expect(dataA?.()).toEqual([{ id: 3, name: "a-replacement" }]);
    expect(dataB?.()).toEqual([{ id: 2, name: "b" }]);

    unmount();
  });

  test("install returns the session; disposing it ends the request without unmounting", async () => {
    const z = createTestZero({ schema, userID: "request" });
    const client = shallowRef<Zero<typeof schema> | undefined>(z);
    const bindings = VueBindings.create({ definitions: createDefinitions({ schema }), client });

    type CapturedResource = { readonly active: boolean; getSnapshot(): { status: string } };

    let capturedSession: object | undefined;
    let sessionClientMatches = false;
    let data: (() => RowSnapshot) | undefined;
    let resource: CapturedResource | undefined;

    const { session: returned, unmount } = mountBindings(bindings, () => {
      const session = bindings.useSession();
      const created = session.createQuery(() => zql.item);
      created.start();
      resource = created;
      capturedSession = session;
      sessionClientMatches = session.client === z;
      const result = bindings.useQuery(() => zql.item);
      data = () => rows(result.data.value);
    });

    expect(capturedSession).toBe(returned);
    expect(sessionClientMatches).toBe(true);

    await z.mutate.item.insert({ id: 1, name: "request" });
    expect(data?.()).toEqual([{ id: 1, name: "request" }]);

    returned.dispose();
    expect(resource?.active).toBe(false);
    expect(resource?.getSnapshot().status).toBe("disabled");

    const other = createTestZero({ schema, userID: "after-dispose" });
    await other.mutate.item.insert({ id: 2, name: "after-dispose" });
    client.value = other;
    await nextTick();
    expect(data?.()).toEqual([{ id: 1, name: "request" }]);

    expect(() => returned.dispose()).not.toThrow();
    unmount();
  });

  test("query and mutator getters accept raw binding paths", async () => {
    const queries = defineQueriesWithType<typeof schema>()({
      item: { all: defineQueryWithType<typeof schema>()(() => zql.item) },
    });

    const definitions = createDefinitions({ schema, queries, mutators: customMutators });
    const z = createTestZero({ schema, userID: "raw", mutators: customMutators });
    const bindings = VueBindings.create({ definitions, client: z });
    let data: (() => RowSnapshot) | undefined;
    let mutate: ((args: { id: number; name: string }) => Promise<string>) | undefined;

    const { unmount } = mountBindings(bindings, () => {
      const result = bindings.useQuery(() => definitions.queries.item.all());
      const mutation = bindings.useMutation(() => definitions.mutators.item.create);
      data = () => rows(result.data.value);
      mutate = async (args) => (await mutation.mutate(args).client).type;
    });

    expect(await mutate?.({ id: 5, name: "raw" })).toBe("success");
    expect(data?.()).toEqual([{ id: 5, name: "raw" }]);

    unmount();
  });

  test("closure getters resolve a registry the bindings do not bind", async () => {
    const externalQueries = defineQueriesWithType<typeof schema>()({
      item: { all: defineQueryWithType<typeof schema>()(() => zql.item) },
    });

    const z = createTestZero({ schema, userID: "external", mutators: customMutators });

    // The bound registries are decoys: a query that matches nothing, and no
    // mutators registry at all. If the closure path consulted them, the data
    // would stay empty and the mutator getter would throw `InvalidMutator`.
    const bindings = VueBindings.create({
      definitions: createDefinitions({ schema, queries: { all: () => zql.item.where("id", 999) } }),
      client: z,
    });

    let data: (() => RowSnapshot) | undefined;
    let mutate: ((args: { id: number; name: string }) => Promise<string>) | undefined;

    const { unmount } = mountBindings(bindings, () => {
      const result = bindings.useQuery(() => externalQueries.item.all());
      const mutation = bindings.useMutation(() => customMutators.item.create);
      data = () => rows(result.data.value);
      mutate = async (args) => (await mutation.mutate(args).client).type;
    });

    expect(await mutate?.({ id: 6, name: "external" })).toBe("success");
    expect(data?.()).toEqual([{ id: 6, name: "external" }]);

    unmount();
  });
});
