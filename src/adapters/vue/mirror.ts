import {
  computed,
  getCurrentScope,
  onScopeDispose,
  shallowRef,
  type ComputedRef,
  type MaybeRefOrGetter,
} from "vue";
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

export type UseQueryError = QueryError & {
  retry: () => void;
};

export type MaybeQueryResult<TReturn> = {
  data: ComputedRef<HumanReadable<TReturn> | undefined>;
  error: ComputedRef<UseQueryError | undefined>;
  status: ComputedRef<QueryStatus>;
};

export type UseQueryOptions = {
  ttl?: TTL | undefined;
  enabled?: MaybeRefOrGetter<boolean> | undefined;
};

/** Mirrors a core query resource snapshot into Vue refs and computeds. */
export function bindQueryResource<TReturn>(
  resource: QueryResource<HumanReadable<TReturn> | undefined>,
): MaybeQueryResult<TReturn> {
  const snapshot = shallowRef(resource.getSnapshot());

  const unsubscribe = resource.subscribe(() => {
    snapshot.value = resource.getSnapshot();
  });

  const retry = (): void => {
    resource.start();
  };

  if (getCurrentScope()) {
    onScopeDispose(() => {
      // Disposal is terminal and does not notify subscribers, so refresh the
      // mirrored snapshot from the resource before dropping the subscription.
      resource.dispose();
      snapshot.value = resource.getSnapshot();
      unsubscribe();
    });
  }

  const data: ComputedRef<HumanReadable<TReturn> | undefined> = computed(() => snapshot.value.data);
  const status: ComputedRef<QueryStatus> = computed(() => snapshot.value.status);

  const error: ComputedRef<UseQueryError | undefined> = computed(() => {
    const snapshotError = snapshot.value.error;

    return snapshotError ? { ...snapshotError, retry } : undefined;
  });

  return { data, error, status };
}

export type UseMutationResult<TMutator extends ZeroMutator> = {
  mutate: (...args: Parameters<TMutator>) => MutatorResult;
  reset: () => void;
  isPending: ComputedRef<boolean>;
  error: ComputedRef<unknown>;
  client: ComputedRef<MutationLegSnapshot>;
  server: ComputedRef<MutationLegSnapshot>;
};

/** Mirrors a core mutation resource snapshot into Vue computeds. */
export function bindMutationResource<TMutator extends ZeroMutator>(
  resource: MutationResource<TMutator>,
): UseMutationResult<TMutator> {
  const snapshot = shallowRef(resource.getSnapshot());

  const unsubscribe = resource.subscribe(() => {
    snapshot.value = resource.getSnapshot();
  });

  if (getCurrentScope()) {
    onScopeDispose(() => {
      resource.dispose();
      snapshot.value = resource.getSnapshot();
      unsubscribe();
    });
  }

  return {
    mutate: (...args: Parameters<TMutator>) => resource.mutate(...args),
    reset: () => resource.reset(),
    isPending: computed(
      () =>
        snapshot.value.client.status === "pending" || snapshot.value.server.status === "pending",
    ),
    error: computed(() => snapshot.value.client.error ?? snapshot.value.server.error),
    client: computed(() => snapshot.value.client),
    server: computed(() => snapshot.value.server),
  };
}
