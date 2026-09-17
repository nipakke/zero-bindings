import type {
  BaseDefaultContext,
  CustomMutatorDefs,
  HumanReadable,
  ReadonlyJSONValue,
  Schema,
  TTL,
  Zero,
} from "@rocicorp/zero";
import {
  resolveGetter,
  type Definitions,
  type MutatorGetter,
  type QueryGetter,
} from "./definitions.ts";
import {
  type MutationOptions,
  MutationController,
  stackMutationOptions,
  type ZeroMutator,
} from "./mutation.ts";
import { QueryController } from "./query-controller.ts";
import type { QuerySignalQuery } from "./query-resolution.ts";
import { mapSource, type Source, toSource, type SourceInput } from "./source.ts";
import type { MutationResource, QueryResource } from "./types.ts";

export type BindingQueryOptions = {
  readonly enabled?: SourceInput<boolean>;
  readonly ttl?: SourceInput<TTL | undefined>;
};

export type ZeroSessionOptions<
  TSchema extends Schema,
  TContext extends BaseDefaultContext,
  MD extends CustomMutatorDefs | undefined,
> = {
  readonly client: SourceInput<Zero<TSchema, MD, TContext> | undefined>;
  /**
   * App-level defaults for every mutation resource this session creates:
   * these callbacks fire before each resource's own, and a resource without
   * a `timeout` inherits this one's.
   */
  readonly mutations?: MutationOptions | undefined;
};

const toError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));

/**
 * The live Zero layer of one application instance: the current client plus the
 * resources created against it. Each resource owns its reactive inputs (query
 * signal, `enabled`, TTL); the session owns the client, so replacing or
 * detaching it restarts every active query against the new one. Disposal is
 * terminal and idempotent.
 */
export class ZeroSession<
  TSchema extends Schema,
  TContext extends BaseDefaultContext = BaseDefaultContext,
  TQueries = undefined,
  TMutators = undefined,
  MD extends CustomMutatorDefs | undefined = undefined,
> {
  /** Creates the session for one application instance and subscribes to its client source. */
  static create<
    TSchema extends Schema,
    TContext extends BaseDefaultContext = BaseDefaultContext,
    TQueries = undefined,
    TMutators = undefined,
    MD extends CustomMutatorDefs | undefined = undefined,
  >(
    definitions: Definitions<TSchema, TContext, TQueries, TMutators>,
    options: ZeroSessionOptions<TSchema, TContext, MD>,
  ): ZeroSession<TSchema, TContext, TQueries, TMutators, MD> {
    return new ZeroSession<TSchema, TContext, TQueries, TMutators, MD>(definitions, options);
  }

  readonly definitions: Definitions<TSchema, TContext, TQueries, TMutators>;

  readonly #clientSource: Source<Zero<TSchema, MD, TContext> | undefined>;
  readonly #queries = new Set<QueryResource<unknown>>();
  readonly #mutations = new Set<MutationResource<ZeroMutator>>();
  readonly #stopClient: () => void;
  #client: Zero<TSchema, MD, TContext> | undefined;
  #clientError: Error | undefined;
  #disposed = false;
  readonly #mutationDefaults: MutationOptions | undefined;

  private constructor(
    definitions: Definitions<TSchema, TContext, TQueries, TMutators>,
    options: ZeroSessionOptions<TSchema, TContext, MD>,
  ) {
    this.definitions = definitions;
    this.#clientSource = toSource(options.client);
    this.#mutationDefaults = options.mutations;

    // Seed from the source: a throwing source attaches in the error state, so
    // every resource settles into an error snapshot instead of the session
    // throwing during creation.
    try {
      this.#client = this.#clientSource.get();
    } catch (error) {
      this.#clientError = toError(error);
    }

    this.#stopClient = this.#clientSource.subscribe(() => {
      try {
        this.#applyClient(this.#clientSource.get(), undefined);
      } catch (error) {
        this.#applyClient(undefined, toError(error));
      }
    });
  }

  /** The current client, or `undefined` while detached. */
  get client(): Zero<TSchema, MD, TContext> | undefined {
    return this.#client;
  }

  /** Attaches, replaces, or detaches the current client; active queries rematerialize in place. */
  setClient(client: Zero<TSchema, MD, TContext> | undefined): void {
    this.#applyClient(client, undefined);
  }

  createQuery<
    TTable extends keyof TSchema["tables"] & string,
    TReturn,
    TInput extends ReadonlyJSONValue | undefined = ReadonlyJSONValue | undefined,
    TOutput extends ReadonlyJSONValue | undefined = ReadonlyJSONValue | undefined,
  >(
    queryGetter: SourceInput<
      QueryGetter<TQueries, QuerySignalQuery<TSchema, TTable, TReturn, TContext, TInput, TOutput>>
    >,
    options?: BindingQueryOptions,
  ): QueryResource<HumanReadable<TReturn> | undefined> {
    const getterSource = toSource(queryGetter);

    const resource = new QueryController<TSchema, TTable, TReturn, MD, TContext, TInput, TOutput>({
      getClient: () => this.#currentClient(),
      // The controller compares resolved keys, so a getter source change that
      // resolves to the current query keeps the live materialization.
      querySignal: mapSource(getterSource, (getter) =>
        resolveGetter(getter, this.definitions.queries, "Query"),
      ),
      enabled: options?.enabled,
      ttl: options?.ttl,
    });

    resource.onDispose(() => {
      this.#queries.delete(resource);
    });
    this.#queries.add(resource);

    return resource;
  }

  createMutation<TMutator extends ZeroMutator>(
    mutatorGetter: SourceInput<MutatorGetter<TMutators, TMutator>>,
    options?: MutationOptions,
  ): MutationResource<TMutator> {
    const getterSource = toSource(mutatorGetter);

    // Mutator getters stay lazy: a source change affects the next call.
    const resource = new MutationController<TMutator, TSchema, MD, TContext>(
      () => this.#client,
      () => resolveGetter(getterSource.get(), this.definitions.mutators, "Mutator"),
      stackMutationOptions(this.#mutationDefaults, options),
    );

    resource.onDispose(() => {
      this.#mutations.delete(resource);
    });
    this.#mutations.add(resource);

    return resource;
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
    this.#stopClient();

    for (const resource of this.#queries) {
      resource.dispose();
    }

    for (const resource of this.#mutations) {
      resource.dispose();
    }
  }

  /** What a resource sees: a failing client source surfaces as its error. */
  #currentClient(): Zero<TSchema, MD, TContext> | undefined {
    if (this.#clientError) {
      throw this.#clientError;
    }

    return this.#client;
  }

  /** Applies a client state, restarting active queries when it actually changed. */
  #applyClient(next: Zero<TSchema, MD, TContext> | undefined, error: Error | undefined): void {
    if (this.#disposed || (next === this.#client && error === this.#clientError)) {
      return;
    }

    this.#client = next;
    this.#clientError = error;

    for (const resource of this.#queries) {
      if (resource.active) {
        resource.start();
      }
    }
  }
}

/** The session type a bindings instance builds, concrete in its five parameters. */
export type BoundSession<
  TSchema extends Schema,
  TContext extends BaseDefaultContext,
  TQueries,
  TMutators,
  MD extends CustomMutatorDefs | undefined,
> = ZeroSession<TSchema, TContext, TQueries, TMutators, MD>;
