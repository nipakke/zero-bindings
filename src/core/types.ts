import type { HumanReadable, MutatorResult, ReadonlyJSONValue, TTL } from "@rocicorp/zero";

/** Zero's mutator result — a locally settling `client` leg and the `server` leg. */
export type { MutatorResult };

export type QueryStatus = "complete" | "cached" | "unknown" | "error" | "disabled";

/** Query data as published to consumers: absent before a client, while disabled, or for empty singular queries. */
export type QueryResult<TReturn> = HumanReadable<TReturn> | undefined;

export type QueryError = { type: string; message: string; details?: unknown };

export type QuerySnapshot<T> = {
  readonly data: T | undefined;
  readonly status: QueryStatus;
  readonly error: QueryError | undefined;
};

export type ObservableResource<T> = {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
  /** Subscribes to disposal; fires once, after which the resource is terminal. */
  onDispose(listener: () => void): () => void;
  dispose(): void;
};

export type QueryResource<T> = ObservableResource<QuerySnapshot<T>> & {
  readonly active: boolean;
  start(): void;
  stop(): void;
  setTTL(ttl: TTL | undefined): void;
};

export type MutationLegStatus = "idle" | "pending" | "success" | "error" | "unavailable";

/**
 * One leg of a mutation. Only a landed `success` can carry `data`: the JSON value
 * the mutator returned on that leg (untyped, as in Zero), absent when it returned nothing.
 */
export type MutationLegSnapshot =
  | { readonly status: Exclude<MutationLegStatus, "success">; readonly error: unknown }
  | {
      readonly status: "success";
      readonly error: undefined;
      readonly data?: ReadonlyJSONValue | undefined;
    };

export type MutationSnapshot = {
  readonly client: MutationLegSnapshot;
  readonly server: MutationLegSnapshot;
};

export type MutationResource<TMutator extends (...args: never[]) => void> =
  ObservableResource<MutationSnapshot> & {
    mutate(...args: Parameters<TMutator>): MutatorResult;
    reset(): void;
  };
