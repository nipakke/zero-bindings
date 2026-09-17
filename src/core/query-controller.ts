import type {
  BaseDefaultContext,
  CustomMutatorDefs,
  Query,
  ReadonlyJSONValue,
  Schema,
  TTL,
  Zero,
} from "@rocicorp/zero";
import { DEFAULT_TTL_MS } from "@rocicorp/zero/bindings";
import { ObservableStore } from "./observable-store.ts";
import { ObservableView, observableViewFactory } from "./observable-view.ts";
import { plainError, resolveQuery, type QuerySignalQuery } from "./query-resolution.ts";
import { toSource, type Source, type SourceInput } from "./source.ts";
import type { QueryError, QueryResult, QueryResource, QuerySnapshot } from "./types.ts";

const DISABLED: QuerySnapshot<never> = {
  data: undefined,
  status: "disabled",
  error: undefined,
};

const UNKNOWN: QuerySnapshot<never> = {
  data: undefined,
  status: "unknown",
  error: undefined,
};

/** Sentinel for "the TTL input has never been read"; `undefined` is a legal TTL. */
const UNREAD_TTL = Symbol("zero-bindings/unread-ttl");

function errorSnapshot(error: QueryError): QuerySnapshot<never> {
  return { data: undefined, status: "error", error };
}

export type QueryControllerConfig<
  TSchema extends Schema,
  TTable extends keyof TSchema["tables"] & string,
  TReturn,
  MD extends CustomMutatorDefs | undefined = undefined,
  TContext extends BaseDefaultContext = BaseDefaultContext,
  TInput extends ReadonlyJSONValue | undefined = ReadonlyJSONValue | undefined,
  TOutput extends ReadonlyJSONValue | undefined = ReadonlyJSONValue | undefined,
> = {
  getClient: () => Zero<TSchema, MD, TContext> | undefined;
  querySignal: SourceInput<QuerySignalQuery<TSchema, TTable, TReturn, TContext, TInput, TOutput>>;
  enabled?: SourceInput<boolean>;
  ttl?: SourceInput<TTL | undefined>;
};

/**
 * Owns one materialized query: its inputs, its Zero view, and its snapshot.
 *
 * The resource is inert until `start()`, which subscribes to the signal,
 * enabled, and TTL inputs and materializes; `stop()` and `dispose()` release
 * the view and the input subscriptions again. Input changes rematerialize only
 * when they change the resolved query key, so a reactive input that re-reads
 * the same query is free.
 */
export class QueryController<
  TSchema extends Schema,
  TTable extends keyof TSchema["tables"] & string,
  TReturn,
  MD extends CustomMutatorDefs | undefined = undefined,
  TContext extends BaseDefaultContext = BaseDefaultContext,
  TInput extends ReadonlyJSONValue | undefined = ReadonlyJSONValue | undefined,
  TOutput extends ReadonlyJSONValue | undefined = ReadonlyJSONValue | undefined,
> implements QueryResource<QueryResult<TReturn>> {
  readonly #getClient: () => Zero<TSchema, MD, TContext> | undefined;
  readonly #signal: Source<QuerySignalQuery<TSchema, TTable, TReturn, TContext, TInput, TOutput>>;
  readonly #enabled: Source<boolean>;
  readonly #ttlInput: Source<TTL | undefined>;
  readonly #store = new ObservableStore<QuerySnapshot<QueryResult<TReturn>>>(DISABLED);
  #view: ObservableView<TReturn> | null = null;
  #viewUnsubscribe: (() => void) | null = null;
  #inputStops: (() => void)[] | null = null;
  #key: string | undefined;
  #ttl: TTL | undefined;
  #ttlFromInput: TTL | undefined | typeof UNREAD_TTL = UNREAD_TTL;
  #generation = 0;
  #active = false;

  constructor(
    config: QueryControllerConfig<TSchema, TTable, TReturn, MD, TContext, TInput, TOutput>,
  ) {
    this.#getClient = config.getClient;
    this.#signal = toSource(config.querySignal);
    this.#enabled = toSource(config.enabled ?? true);
    this.#ttlInput = toSource(config.ttl);
  }

  get active(): boolean {
    return this.#active;
  }

  getSnapshot(): QuerySnapshot<QueryResult<TReturn>> {
    return this.#store.getSnapshot();
  }

  subscribe(listener: () => void): () => void {
    return this.#store.subscribe(listener);
  }

  onDispose(listener: () => void): () => void {
    return this.#store.onDispose(listener);
  }

  start(): void {
    if (this.#store.disposed) {
      return;
    }

    this.#active = true;
    this.#subscribeInputs();
    this.#materialize(true);
  }

  stop(): void {
    if (this.#store.disposed) {
      return;
    }

    this.#active = false;
    this.#generation++;
    this.#unsubscribeInputs();
    // Stop keeps the last snapshot: it is already the store's value, so there
    // is no transition to publish.
    this.#teardownView();
  }

  setTTL(ttl: TTL | undefined): void {
    this.#ttl = ttl;
    this.#view?.updateTTL(ttl ?? DEFAULT_TTL_MS);
  }

  dispose(): void {
    if (this.#store.disposed) {
      return;
    }

    this.#active = false;
    this.#generation++;
    this.#unsubscribeInputs();
    this.#teardownView();
    // Terminal teardown resets to disabled without notifying; disposal is not a transition.
    this.#store.reset(DISABLED);
    this.#store.dispose();
  }

  #subscribeInputs(): void {
    if (this.#inputStops !== null) {
      return;
    }

    this.#inputStops = [
      this.#signal.subscribe(() => {
        this.#refresh();
      }),
      this.#enabled.subscribe(() => {
        this.#refresh();
      }),
      this.#ttlInput.subscribe(() => {
        this.#pullTTL();
      }),
    ];
  }

  #unsubscribeInputs(): void {
    for (const stop of this.#inputStops ?? []) {
      stop();
    }

    this.#inputStops = null;
  }

  /** Source-driven materialization: unchanged inputs leave the live view alone. */
  #refresh(): void {
    if (this.#store.disposed || !this.#active) {
      return;
    }

    this.#materialize(false);
  }

  /**
   * Re-reads every input and publishes the snapshot it implies. `force` rebuilds
   * the materialization even when the resolved key is unchanged (`start()` and
   * client swaps); source-driven refreshes keep the live view in that case.
   * Inputs are caller-provided, so a throw settles into an error snapshot
   * instead of escaping into the caller's commit/effect machinery.
   */
  #materialize(force: boolean): void {
    const generation = ++this.#generation;
    let enabled: boolean;
    let ttl: TTL | undefined;

    try {
      this.#pullTTL();
      ttl = this.#ttl;
      enabled = this.#enabled.get();
    } catch (error) {
      this.#settle(errorSnapshot(plainError("QuerySignalError", error)));

      return;
    }

    if (!enabled) {
      this.#settle(DISABLED);

      return;
    }

    let client: Zero<TSchema, MD, TContext> | undefined;

    try {
      client = this.#getClient();
    } catch (error) {
      this.#settle(errorSnapshot(plainError("MaterializationError", error)));

      return;
    }

    if (!client) {
      this.#settle(UNKNOWN);

      return;
    }

    const resolved = resolveQuery(client, () => this.#signal.get());

    if (!resolved.ok) {
      this.#settle(resolved.kind === "disabled" ? DISABLED : errorSnapshot(resolved.error));

      return;
    }

    if (!force && this.#view !== null && resolved.key === this.#key) {
      return;
    }

    this.#key = resolved.key;
    this.#teardownView();
    this.#buildView(client, resolved.query, ttl, generation);
  }

  /** Builds and subscribes the view; a stale generation or disposal discards it. */
  #buildView(
    client: Zero<TSchema, MD, TContext>,
    query: Query<TTable, TSchema, TReturn>,
    ttl: TTL | undefined,
    generation: number,
  ): void {
    try {
      const view = client.materialize(query, observableViewFactory, {
        ttl: ttl ?? DEFAULT_TTL_MS,
      });

      if (this.#store.disposed || generation !== this.#generation) {
        view.destroy();

        return;
      }

      this.#view = view;
      this.#viewUnsubscribe = view.subscribe(() => {
        this.#store.publish(view.getSnapshot());
      });
      this.#store.publish(view.getSnapshot());
    } catch (error) {
      this.#settle(errorSnapshot(plainError("MaterializationError", error)));
    }
  }

  /** Publishes a snapshot that no live view backs: the previous materialization is torn down. */
  #settle(snapshot: QuerySnapshot<never>): void {
    this.#key = undefined;
    this.#teardownView();
    this.#store.publish(snapshot);
  }

  /** Applies the TTL input when it changed; a manual `setTTL()` survives until then. */
  #pullTTL(): void {
    const ttl = this.#ttlInput.get();

    if (ttl === this.#ttlFromInput) {
      return;
    }

    this.#ttlFromInput = ttl;
    this.setTTL(ttl);
  }

  #teardownView(): void {
    this.#viewUnsubscribe?.();
    this.#viewUnsubscribe = null;
    this.#view?.destroy();
    this.#view = null;
  }
}
