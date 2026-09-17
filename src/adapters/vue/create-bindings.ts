import { computed, inject, toValue, type App, type InjectionKey, type MaybeRefOrGetter } from "vue";
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
} from "./mirror.ts";
import { toCoreQuerySource, toCoreSource } from "./source.ts";

/**
 * Everything a Vue bindings instance is created from: the immutable definitions,
 * the client as a ref or getter so replacement stays reactive, and the app-level
 * mutation defaults. The client enters here and only here —
 * installing the bindings carries it no further. One object, one client source:
 * the client source belongs to the installed host, never share one across hosts.
 */
export type VueBindingsOptions<
  TSchema extends Schema,
  TContext extends BaseDefaultContext = BaseDefaultContext,
  TQueries = undefined,
  TMutators = undefined,
  MD extends CustomMutatorDefs | undefined = undefined,
> = {
  readonly definitions: Definitions<TSchema, TContext, TQueries, TMutators>;
  /** The application's Zero client, as a ref or getter; `undefined` before it exists. */
  readonly client: MaybeRefOrGetter<Zero<TSchema, MD, TContext> | undefined>;
  /**
   * App-level mutation defaults handed to every host session this instance
   * installs: these callbacks fire before each `useMutation` resource's own,
   * and a resource without a `timeout` inherits this one's.
   */
  readonly mutations?: MutationOptions | undefined;
};

/**
 * Module-scope bindings: immutable definitions plus the client source they were
 * created with. Installing them on a host creates that host's core
 * `ZeroSession` from the bindings' client source; the session is what owns the
 * client subscription, the resources the composables create, and their
 * lifetime.
 *
 * The class is the type. Members are instance-bound closures, not prototype
 * methods, so a bindings instance stays safe to destructure.
 */
export class VueBindings<
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
    options: VueBindingsOptions<TSchema, TContext, TQueries, TMutators, MD>,
  ): VueBindings<TSchema, TContext, TQueries, TMutators, MD> {
    return new VueBindings<TSchema, TContext, TQueries, TMutators, MD>(options);
  }

  readonly definitions: Definitions<TSchema, TContext, TQueries, TMutators>;

  readonly #client: MaybeRefOrGetter<Zero<TSchema, MD, TContext> | undefined>;
  readonly #mutations: MutationOptions | undefined;
  // `MD` is fixed by the client source this instance was created with, so the
  // session type is concrete: no erasure. One key per bindings instance, so it
  // serves one client per installed host: a host that needs a second client
  // installs a second bindings instance built from the same definitions.
  // SAFETY: a fresh unique symbol per instance is only ever used as its own injection key;
  // the `InjectionKey` brand is added for `inject`'s typing alone.
  readonly #key = Symbol("zero-bindings/vue") as InjectionKey<
    BoundSession<TSchema, TContext, TQueries, TMutators, MD>
  >;

  /** The installed session: the core escape hatch for `start`/`stop`/`setTTL`/`dispose`. */
  readonly useSession = (): BoundSession<TSchema, TContext, TQueries, TMutators, MD> => {
    const session = inject(this.#key);

    if (!session) {
      throw new Error("Zero Vue bindings were not installed: call app.use(bindings) first.");
    }

    return session;
  };

  private constructor(options: VueBindingsOptions<TSchema, TContext, TQueries, TMutators, MD>) {
    this.definitions = options.definitions;
    this.#client = options.client;
    this.#mutations = options.mutations;
  }

  /**
   * Builds this host's session from the bindings' client source, provides it,
   * disposes it on `app.onUnmount`, and returns it. SSR data rendering lives in
   * `zero-bindings/experimental_nuxt`, which installs client-side only.
   */
  readonly install = (app: App): BoundSession<TSchema, TContext, TQueries, TMutators, MD> => {
    const session: BoundSession<TSchema, TContext, TQueries, TMutators, MD> = ZeroSession.create(
      this.definitions,
      { client: toCoreSource(this.#client), mutations: this.#mutations },
    );

    app.provide(this.#key, session);
    app.onUnmount(() => {
      session.dispose();
    });

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
    const optionsRef = computed(() => toValue(queryOptions));

    // Re-evaluate the bound getter inside a Vue watcher so reactive reads
    // (refs, other getters) drive rematerialization; the session resolves the
    // same getter again through the thunk's stable `get()`.
    const querySource = toCoreQuerySource(() =>
      resolveGetter(queryGetter, this.definitions.queries, "Query"),
    );

    const resource = session.createQuery<TTable, TReturn, TInput, TOutput>(querySource, {
      enabled: toCoreSource(() => toValue(optionsRef.value?.enabled) ?? true),
      ttl: toCoreSource(() => optionsRef.value?.ttl),
    });

    // `useQuery` is the live-query composable: the session hands back an inert
    // resource, so the composable is what starts it.
    resource.start();

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
