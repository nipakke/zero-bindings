import { getContext, setContext } from "svelte";
import type {
  BaseDefaultContext,
  CustomMutatorDefs,
  ReadonlyJSONValue,
  Schema,
  Zero,
} from "@rocicorp/zero";
import {
  resolveGetter,
  type Definitions,
  type MutatorGetter,
  type QueryGetter,
} from "../../core/definitions.ts";
import type { MutationOptions, ZeroMutator } from "../../core/mutation.ts";
import { type BoundSession, ZeroSession } from "../../core/session.ts";
import type { QuerySignalQuery } from "../../core/query-resolution.ts";
import {
  bindMutationResource,
  bindQueryResource,
  type MaybeQueryResult,
  type UseMutationResult,
  type UseQueryOptions,
} from "./mirror.svelte.ts";
import {
  resolveSource,
  toCoreQuerySource,
  toCoreSource,
  type MaybeSource,
} from "./source.svelte.ts";

/**
 * Everything a Svelte bindings instance is created from: the immutable
 * definitions, the client as a constant or getter so replacement stays
 * reactive, and the app-level mutation defaults. The client enters here and
 * only here. One object, one client source: the session that reads it is
 * built per component tree by `ZeroProvider`, so a server render and a client
 * render — or two trees — each resolve their own.
 */
export type SvelteBindingsOptions<
  TSchema extends Schema,
  TContext extends BaseDefaultContext = BaseDefaultContext,
  TQueries = undefined,
  TMutators = undefined,
  MD extends CustomMutatorDefs | undefined = undefined,
> = {
  readonly definitions: Definitions<TSchema, TContext, TQueries, TMutators>;
  /** The application's Zero client, as a constant or getter; `undefined` before it exists. */
  readonly client: MaybeSource<Zero<TSchema, MD, TContext> | undefined>;
  /**
   * App-level mutation defaults handed to every session this instance
   * provides: these callbacks fire before each `useQuery` sibling resource's
   * own, and a resource without a `timeout` inherits this one's.
   */
  readonly mutations?: MutationOptions | undefined;
};

/**
 * Module-scope bindings: immutable definitions plus the client source they
 * were created with. Unlike Vue — where `install(app)` builds the host's
 * session — Svelte has no app object and `setContext` is init-only, so the
 * session is built inside the component tree: `ZeroProvider` calls
 * {@link SvelteBindings.provide} during its own initialization, and the
 * hooks resolve that session from context.
 *
 * The class is the type. Members are instance-bound closures, not prototype
 * methods, so a bindings instance stays safe to destructure.
 */
export class SvelteBindings<
  TSchema extends Schema,
  TContext extends BaseDefaultContext = BaseDefaultContext,
  TQueries = undefined,
  TMutators = undefined,
  MD extends CustomMutatorDefs | undefined = undefined,
> {
  /** Creates the bindings for one client source; nothing stateful is built yet. */
  static create<
    TSchema extends Schema,
    TContext extends BaseDefaultContext = BaseDefaultContext,
    TQueries = undefined,
    TMutators = undefined,
    MD extends CustomMutatorDefs | undefined = undefined,
  >(
    options: SvelteBindingsOptions<TSchema, TContext, TQueries, TMutators, MD>,
  ): SvelteBindings<TSchema, TContext, TQueries, TMutators, MD> {
    return new SvelteBindings<TSchema, TContext, TQueries, TMutators, MD>(options);
  }

  readonly definitions: Definitions<TSchema, TContext, TQueries, TMutators>;

  readonly #client: MaybeSource<Zero<TSchema, MD, TContext> | undefined>;
  readonly #mutations: MutationOptions | undefined;
  // `MD` is fixed by the client source this instance was created with, so the
  // session type is concrete: no erasure. One key per bindings instance, so
  // it serves one client per provided tree: a page that needs a second client
  // renders a second provider for another instance built from the same
  // definitions.
  readonly #key = Symbol("zero-bindings/svelte");

  /** The provided session: the core escape hatch for `client`/`setClient`/`createQuery`/`dispose`. */
  readonly useSession = (): BoundSession<TSchema, TContext, TQueries, TMutators, MD> => {
    const session = getContext<
      BoundSession<TSchema, TContext, TQueries, TMutators, MD> | undefined
    >(this.#key);

    if (!session) {
      throw new Error(
        "Zero Svelte bindings were not provided: render <ZeroProvider {bindings}> above this component.",
      );
    }

    return session;
  };

  private constructor(options: SvelteBindingsOptions<TSchema, TContext, TQueries, TMutators, MD>) {
    this.definitions = options.definitions;
    this.#client = options.client;
    this.#mutations = options.mutations;
  }

  /**
   * Builds this tree's session from the bindings' client source and mutation
   * defaults, provides it to the subtree, and returns it. `ZeroProvider`
   * calls it during component initialization — `setContext` is init-only —
   * and disposes the returned session when the provider is destroyed.
   */
  readonly provide = (): BoundSession<TSchema, TContext, TQueries, TMutators, MD> => {
    const session: BoundSession<TSchema, TContext, TQueries, TMutators, MD> = ZeroSession.create(
      this.definitions,
      { client: toCoreSource(this.#client), mutations: this.#mutations },
    );

    setContext(this.#key, session);

    return session;
  };

  readonly useQuery = <
    TTable extends keyof TSchema["tables"] & string,
    TReturn,
    TInput extends ReadonlyJSONValue | undefined = ReadonlyJSONValue | undefined,
    TOutput extends ReadonlyJSONValue | undefined = ReadonlyJSONValue | undefined,
  >(
    queryGetter: QueryGetter<
      TQueries,
      QuerySignalQuery<TSchema, TTable, TReturn, TContext, TInput, TOutput>
    >,
    queryOptions?: UseQueryOptions | (() => UseQueryOptions | undefined),
  ): MaybeQueryResult<TReturn> => {
    const session = this.useSession();
    const readOptions = (): UseQueryOptions | undefined => resolveSource(queryOptions);

    // Re-evaluate the bound getter inside a tracking effect so reactive reads
    // (any `$state` the getter touches) drive rematerialization; the session
    // resolves the same getter again through the thunk's stable `get()`.
    const querySource = toCoreQuerySource(() =>
      resolveGetter(queryGetter, this.definitions.queries, "Query"),
    );

    const resource = session.createQuery<TTable, TReturn, TInput, TOutput>(querySource, {
      enabled: toCoreSource(() => resolveSource(readOptions()?.enabled) ?? true),
      ttl: toCoreSource(() => readOptions()?.ttl),
    });

    // `useQuery` is the live-query hook: the session hands back an inert
    // resource and the mirror's effect starts it (client-side only).
    return bindQueryResource(resource);
  };

  readonly useMutation = <TMutator extends ZeroMutator>(
    mutatorGetter: MutatorGetter<TMutators, TMutator>,
    mutationOptions?: MutationOptions,
  ): UseMutationResult<TMutator> =>
    bindMutationResource(
      this.useSession().createMutation<TMutator>(mutatorGetter, mutationOptions),
    );
}

export type AnySvelteBindings = SvelteBindings<any, any, any, any, any>;
