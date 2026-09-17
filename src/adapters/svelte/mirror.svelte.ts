import { untrack } from "svelte";
import type { HumanReadable, TTL } from "@rocicorp/zero";
import type { ZeroMutator } from "../../core/mutation.ts";
import type {
  MutationLegSnapshot,
  MutationResource,
  MutatorResult,
  QueryError,
  QueryResource,
  QueryStatus,
} from "../../core/types.ts";
import type { MaybeSource } from "./source.svelte.ts";

export type UseQueryError = QueryError & {
  retry: () => void;
};

/**
 * The mirrored query result. Members are getters over one swapped snapshot,
 * so reading them in a template, `$derived`, or `$effect` tracks changes.
 */
export type MaybeQueryResult<TReturn> = {
  readonly data: HumanReadable<TReturn> | undefined;
  readonly error: UseQueryError | undefined;
  readonly status: QueryStatus;
};

export type UseQueryOptions = {
  ttl?: TTL | undefined;
  enabled?: MaybeSource<boolean> | undefined;
};

/**
 * Mirrors a core query resource snapshot into runes state. Start and teardown
 * share one effect: effects never run during SSR, so a server render neither
 * starts the resource nor registers a disposal — the inert snapshot it reads
 * is `unknown`, and the client-side effect owns the whole live lifecycle.
 */
export function bindQueryResource<TReturn>(
  resource: QueryResource<HumanReadable<TReturn> | undefined>,
): MaybeQueryResult<TReturn> {
  let snapshot = $state.raw(resource.getSnapshot());

  const retry = (): void => {
    untrack(() => {
      resource.start();
    });
  };

  $effect(() =>
    untrack(() => {
      const stop = resource.subscribe(() => {
        snapshot = resource.getSnapshot();
      });

      resource.start();
      // Catch up: the resource can move between creation and this flush.
      snapshot = resource.getSnapshot();

      return () => {
        // Disposal is terminal and does not notify, so refresh before stopping.
        resource.dispose();
        snapshot = resource.getSnapshot();
        stop();
      };
    }),
  );

  return {
    get data() {
      return snapshot.data;
    },
    get status() {
      return snapshot.status;
    },
    get error() {
      const error = snapshot.error;

      return error ? { ...error, retry } : undefined;
    },
  };
}

export type UseMutationResult<TMutator extends ZeroMutator> = {
  mutate: (...args: Parameters<TMutator>) => MutatorResult;
  reset: () => void;
  readonly isPending: boolean;
  readonly error: unknown;
  readonly client: MutationLegSnapshot;
  readonly server: MutationLegSnapshot;
};

/** Mirrors a core mutation resource snapshot into runes state. */
export function bindMutationResource<TMutator extends ZeroMutator>(
  resource: MutationResource<TMutator>,
): UseMutationResult<TMutator> {
  let snapshot = $state.raw(resource.getSnapshot());
  $effect(() =>
    untrack(() => {
      const stop = resource.subscribe(() => {
        snapshot = resource.getSnapshot();
      });

      return () => {
        resource.dispose();
        snapshot = resource.getSnapshot();
        stop();
      };
    }),
  );

  return {
    mutate: (...args) =>
      untrack(() => {
        return resource.mutate(...args);
      }),
    reset: () =>
      untrack(() => {
        resource.reset();
      }),
    get isPending() {
      return snapshot.client.status === "pending" || snapshot.server.status === "pending";
    },
    get error() {
      return snapshot.client.error ?? snapshot.server.error;
    },
    get client() {
      return snapshot.client;
    },
    get server() {
      return snapshot.server;
    },
  };
}
