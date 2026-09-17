import { Zero, type CustomMutatorDefs, type Schema, type ZeroOptions } from "@rocicorp/zero";

/** Options every test client shares and no test overrides. */
const testZeroOptions = {
  // No server: the client syncs nothing and never opens a connection.
  server: null,
  kvStore: "mem",
  // Zero logs through its sink (e.g. "No socket origin provided"); tests stay quiet.
  logSink: { log: () => {} },
} as const;

/** The client fields a test picks: its schema, a user, and optional mutators. */
type TestZeroOptions<TSchema extends Schema, MD extends CustomMutatorDefs | undefined> = Pick<
  ZeroOptions<TSchema, MD>,
  "schema" | "userID" | "mutators"
>;

/**
 * A local-only `Zero` client for `schema`, identified by `userID`. The return
 * type keeps `MD`, so passing `mutators` also types `client.mutate.<ns>.<name>`.
 */
export function createTestZero<
  TSchema extends Schema,
  MD extends CustomMutatorDefs | undefined = undefined,
>(options: TestZeroOptions<TSchema, MD>): Zero<TSchema, MD> {
  return new Zero<TSchema, MD>({ ...testZeroOptions, ...options });
}

/**
 * `client` with a connected server whose mutation legs never settle: a run can
 * only end through the timeout. Every other field stays the real local-only
 * client.
 */
export function pendingMutationClient<
  TSchema extends Schema,
  MD extends CustomMutatorDefs | undefined,
>(client: Zero<TSchema, MD>): Zero<TSchema, MD> {
  return new Proxy(client, {
    get(target, prop) {
      if (prop === "server") {
        return {};
      }

      if (prop === "connection") {
        return { state: { current: { name: "connected" } } };
      }

      if (prop === "mutate") {
        return () => ({
          client: new Promise<never>(() => {}),
          server: new Promise<never>(() => {}),
        });
      }

      // SAFETY: this proxy only forwards property reads the caller made on the
      // client itself, so `prop` names a `Zero` member; a key the client lacks
      // reads `undefined`, exactly what `Reflect.get` returned.
      const value = target[prop as keyof typeof target];

      // A proxied property name is unbounded: only this boundary sees method vs data.
      // oxlint-disable-next-line anti-slop/no-runtime-typeof
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** A `Zero` client with `materialize` recorded, and the TTLs that reached it. */
interface TtlSpyClient<TSchema extends Schema, MD extends CustomMutatorDefs | undefined> {
  client: Zero<TSchema, MD>;
  /** Every materialization's TTL, in call order. */
  seen: unknown[];
}

/**
 * `client` with `materialize` recorded: `seen` collects the TTL of every
 * materialization, in call order.
 */
export function ttlSpyClient<TSchema extends Schema, MD extends CustomMutatorDefs | undefined>(
  client: Zero<TSchema, MD>,
): TtlSpyClient<TSchema, MD> {
  const seen: unknown[] = [];

  const spied = new Proxy(client, {
    get(target, prop) {
      if (prop === "materialize") {
        return (...args: Parameters<Zero<TSchema, MD>["materialize"]>) => {
          seen.push(args[2]?.ttl);

          return target.materialize(...args);
        };
      }

      // SAFETY: this proxy only forwards property reads the caller made on the
      // client itself, so `prop` names a `Zero` member; a key the client lacks
      // reads `undefined`, exactly what `Reflect.get` returned.
      const value = target[prop as keyof typeof target];

      // A proxied property name is unbounded: only this boundary sees method vs data.
      // oxlint-disable-next-line anti-slop/no-runtime-typeof
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return { client: spied, seen };
}
