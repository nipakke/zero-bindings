import { computed, toValue, type App, type MaybeRefOrGetter, type Ref } from "vue";
import type {
  BaseDefaultContext,
  CustomMutatorDefs,
  HumanReadable,
  ReadonlyJSONValue,
  Schema,
  Zero,
} from "@rocicorp/zero";
import { useAsyncData, useNuxtApp } from "nuxt/app";
import {
  resolveGetter,
  type Definitions,
  type MutatorGetter,
  type QueryGetter,
} from "../../core/definitions.ts";
import type { MutationOptions, ZeroMutator } from "../../core/mutation.ts";
import { resolveQuery, type QuerySignalQuery } from "../../core/query-resolution.ts";
import type { BoundSession } from "../../core/session.ts";
import type { MutationLegSnapshot, QueryStatus } from "../../core/types.ts";
import { VueBindings, type VueBindingsOptions } from "../vue/create-bindings.ts";
import type { MaybeQueryResult, UseMutationResult, UseQueryOptions } from "../vue/mirror.ts";
import { ssrQueryKey } from "./query-key.ts";
import { runOnce } from "./ssr-run.ts";

/** {@link UseQueryOptions} plus the SSR payload key override. */
export type UseNuxtQueryOptions = UseQueryOptions & { ssrKey?: string | undefined };

/** A retry that cannot do anything on the SSR path: there is no resource to restart. */
const noop = (): void => {};

/**
 * What a mutation resource reports during the server render: nothing has run,
 * nothing is pending, and there is no error. `mutate` throws rather than
 * no-op'ing — a mutation silently dropped on the server is a bug worth hearing
 * about, and mutations belong to the browser by construction.
 */
function idleMutation<TMutator extends ZeroMutator>(): UseMutationResult<TMutator> {
  return {
    mutate: () => {
      throw new Error("Mutation resources do not run during SSR; call mutate() from the browser.");
    },
    reset: noop,
    isPending: computed<boolean>(() => false),
    error: computed<unknown>(() => undefined),
    client: computed<MutationLegSnapshot>(() => ({ status: "idle", error: undefined })),
    server: computed<MutationLegSnapshot>(() => ({ status: "idle", error: undefined })),
  };
}

/** What this adapter reads off `useAsyncData`: the payload rows or nothing, plus the run failure. */
type SsrPayload<TReturn> = {
  data: Ref<HumanReadable<TReturn> | undefined>;
  error: Ref<Error | undefined>;
};

/**
 * The one `useAsyncData` shape both renders use: same key, same handler, so the
 * browser finds the payload the server produced.
 */
function loadPayload<TReturn>(
  key: string,
  load: () => Promise<HumanReadable<TReturn> | undefined>,
): SsrPayload<TReturn> {
  // SAFETY: `useAsyncData` types its data as `PickFrom<DataT, PickKeys> | DefaultT`, a
  // conditional that never reduces while `TReturn` is generic; with no `pick` and no
  // `default` the value really is the handler's result, which is what this reads.
  return useAsyncData(key, load, { deep: false }) as SsrPayload<TReturn>;
}

/**
 * Nuxt bindings: `VueBindings` plus the SSR data path. The Vue bindings stay the
 * whole client story (install, session, mutation resources, live query
 * resources); this class adds one server render pass and the browser-side
 * handoff from payload rows to live rows.
 *
 * The SSR contract, all of it load-bearing for consumers:
 *
 * - The payload key is derived from the query resolved at setup, not from the
 *   client: `zero:<hash>:<one|many>`. A later query-getter change keeps the live
 *   path reactive but never re-keys the payload — pass `ssrKey` for that.
 * - While payload rows are showing, `status` is still the live resource's
 *   (`"unknown"` until the client syncs). Templates must gate on `data`, not on
 *   `status`, during takeover.
 * - Live data wins as soon as the live resource reaches `complete` or `error`.
 *   Payload rows are never written into the Zero cache or the live resource.
 * - The browser calls the same `useAsyncData` key, so an SPA navigation with no
 *   payload re-runs the query client-side — the intended fallback.
 * - `useMutation` is inert on the server: it installs no resource, `isPending`
 *   is false, `error` is undefined, and `mutate` throws. A server render sets up
 *   the form it will hand to the browser; it never runs a mutation.
 */
export class NuxtBindings<
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
  ): NuxtBindings<TSchema, TContext, TQueries, TMutators, MD> {
    return new NuxtBindings<TSchema, TContext, TQueries, TMutators, MD>(options);
  }

  readonly definitions: Definitions<TSchema, TContext, TQueries, TMutators>;

  readonly #vue: VueBindings<TSchema, TContext, TQueries, TMutators, MD>;
  readonly #client: MaybeRefOrGetter<Zero<TSchema, MD, TContext> | undefined>;

  private constructor(options: VueBindingsOptions<TSchema, TContext, TQueries, TMutators, MD>) {
    this.#client = options.client;
    this.#vue = VueBindings.create(options);
    this.definitions = this.#vue.definitions;
  }

  /**
   * Installs the Vue session — client-side only. During SSR there is no session
   * and nothing to dispose: the render pulls its rows through `useQuery`'s SSR
   * path and the browser builds the session it hydrates into. Returns the
   * installed session (what the host disposes at teardown).
   */
  readonly install = (
    app: App,
  ): BoundSession<TSchema, TContext, TQueries, TMutators, MD> | undefined =>
    useNuxtApp().ssrContext ? undefined : this.#vue.install(app);

  /**
   * The installed session. There is none during SSR — `install()` builds it
   * client-side only — so this throws a message naming that cause instead of the
   * Vue adapter's "not installed", which would be misleading here: the bindings
   * were installed, the server simply has no session.
   */
  readonly useSession = (): BoundSession<TSchema, TContext, TQueries, TMutators, MD> => {
    if (useNuxtApp().ssrContext) {
      throw new Error(
        "useSession() has no session during SSR: NuxtBindings.install() builds one client-side only. Keep session-touching code client-only and read server rows through useQuery().",
      );
    }

    return this.#vue.useSession();
  };

  /** SSR-inert: the server render reports nothing has run and installs no resource. */
  readonly useMutation = <TMutator extends ZeroMutator>(
    mutatorGetter: MutatorGetter<TMutators, TMutator>,
    mutationOptions?: MutationOptions,
  ): UseMutationResult<TMutator> =>
    useNuxtApp().ssrContext
      ? idleMutation<TMutator>()
      : this.#vue.useMutation(mutatorGetter, mutationOptions);

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
    queryOptions?: UseNuxtQueryOptions | (() => UseNuxtQueryOptions | undefined),
  ): MaybeQueryResult<TReturn> => {
    const options = toValue(queryOptions);
    const zero = toValue(this.#client);
    const server = Boolean(useNuxtApp().ssrContext);

    if (server) {
      if (!zero) {
        throw new Error(
          "Nuxt SSR queries require the bindings' client to be set during the server render.",
        );
      }

      const resolution = resolveQuery(zero, () =>
        resolveGetter(queryGetter, this.definitions.queries, "Query"),
      );

      const enabled = options?.enabled === undefined || toValue(options.enabled);

      if (!resolution.ok || !enabled) {
        const status: QueryStatus = resolution.ok
          ? "disabled"
          : resolution.kind === "error"
            ? "error"
            : "disabled";

        const error =
          resolution.ok || resolution.kind !== "error"
            ? undefined
            : { ...resolution.error, retry: noop };

        return {
          data: computed<HumanReadable<TReturn> | undefined>(() => undefined),
          status: computed<QueryStatus>(() => status),
          error: computed(() => error),
        };
      }

      const asyncData = loadPayload(options?.ssrKey ?? ssrQueryKey(resolution.query), () =>
        runOnce(zero, resolution.query),
      );

      return {
        data: computed<HumanReadable<TReturn> | undefined>(() => asyncData.data.value ?? undefined),
        status: computed<QueryStatus>(() => (asyncData.error.value ? "error" : "complete")),
        error: computed(() =>
          asyncData.error.value
            ? { type: "SsrQueryError", message: asyncData.error.value.message, retry: noop }
            : undefined,
        ),
      };
    }

    const live = this.#vue.useQuery(queryGetter, queryOptions);

    if (!zero) {
      return live;
    }

    const resolution = resolveQuery(zero, () =>
      resolveGetter(queryGetter, this.definitions.queries, "Query"),
    );

    if (!resolution.ok || (options?.enabled !== undefined && !toValue(options.enabled))) {
      return live;
    }

    // Same key, same handler as the server render: the payload this call finds
    // is what it shows until the live resource reaches a terminal status.
    const asyncData = loadPayload(options?.ssrKey ?? ssrQueryKey(resolution.query), () =>
      runOnce(zero, resolution.query),
    );

    return {
      data: computed(() =>
        live.status.value === "complete" || live.status.value === "error"
          ? live.data.value
          : (asyncData.data.value ?? live.data.value),
      ),
      status: live.status,
      error: live.error,
    };
  };
}
