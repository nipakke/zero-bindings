import type {
  BaseDefaultContext,
  CustomMutatorDefs,
  MutateRequest,
  MutatorResultDetails,
  ReadonlyJSONValue,
  Schema,
  Zero,
} from "@rocicorp/zero";
import { ObservableStore } from "./observable-store.ts";
import type {
  MutationLegSnapshot,
  MutationResource,
  MutationSnapshot,
  MutatorResult,
} from "./types.ts";

export class ClientUnavailableError extends Error {
  constructor() {
    super("Zero client is unavailable");
    this.name = "ClientUnavailableError";
  }
}

export class DisposedMutationError extends Error {
  constructor() {
    super("Mutation resource is disposed");
    this.name = "DisposedMutationError";
  }
}

/**
 * The branded settle error: every recognized Zero mutator failure is reported
 * as a `MutationError` whose `cause` is Zero's raw resolved-failure record
 * (`{ type: "error", error: { type, message, details? } }`), kept intact so
 * `details` stay reachable. Unrecognized rejection reasons pass through unbranded.
 */
export class MutationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MutationError";
  }
}

/** The branded settle error of the resource timeout: a leg still pending at expiry. */
export class MutationTimeoutError extends MutationError {
  constructor(timeoutMs: number) {
    super(`Mutation timed out after ${timeoutMs}ms`);
    this.name = "MutationTimeoutError";
  }
}

/**
 * Structural constraint for a Zero mutator callable: invoked with its argument
 * tuple it produces a {@link MutateRequest} executed via `zero.mutate()`.
 * Defined once in core so adapters never duplicate it.
 */
export type ZeroMutator = (...args: never[]) => {
  readonly mutator: unknown;
  readonly args: unknown;
};

export type MutationKind = "client" | "server";

/** Settle order is load-bearing: a client error cascades before the server is considered. */
const MUTATION_KINDS: readonly MutationKind[] = ["client", "server"];

/** Everything a settle tells its listeners: which mutator, on which leg, with which args. */
export type MutationInfo = {
  readonly mutatorName: string;
  readonly kind: MutationKind;
  readonly args: readonly unknown[];
};

export type MutationCallbacks = {
  onSuccess?: (info: MutationInfo) => void;
  onError?: (info: MutationInfo & { readonly error: unknown }) => void;
  onSettled?: (info: MutationInfo & { readonly error?: unknown }) => void;
};

/**
 * The options of one mutation resource. The session's `mutations` defaults
 * stack beneath it: on every settle the defaults' callbacks fire first, then
 * this resource's, and the resource's `timeout` — if it sets one — replaces
 * the default's. `timeout` is in milliseconds, defaults to
 * {@link DEFAULT_TIMEOUT_MS}, and 0 disables it.
 */
export type MutationOptions = MutationCallbacks & {
  timeout?: number;
};

const DEFAULT_TIMEOUT_MS = 5_000;

const IDLE_SNAPSHOT: MutationSnapshot = {
  client: { status: "idle", error: undefined },
  server: { status: "idle", error: undefined },
};

/**
 * Zero resolves failed legs with `{ type: "error", error: {...} }`
 * (`out/zero-client/src/client/mutator-proxy.js:105-123`) and never rejects
 * them; genuine rejections (`close()`, post-close) are `Error`-ish without `type`.
 */
function brandError(cause: unknown) {
  if (cause instanceof MutationError) {
    return cause;
  }

  /* oxlint-disable anti-slop/no-runtime-typeof -- thrown-value I/O boundary: an arbitrary rejection reason is decoded against Zero's resolved-failure skeleton. */
  // exactly Zero's resolved-failure skeleton, not a guess at "what an error looks like" —
  // anything else passes through unbranded rather than renamed under a guess.
  const isResolvedFailure =
    typeof cause === "object" &&
    cause !== null &&
    "type" in cause &&
    cause.type === "error" &&
    "error" in cause;

  if (!isResolvedFailure) {
    return cause;
  }

  const inner = cause.error; // `{ type: "zero" | "app", message, details? }`

  const message =
    typeof inner === "object" && inner !== null && "message" in inner ? inner.message : undefined;

  const text = typeof message === "string" ? message : "Mutation failed";
  /* oxlint-enable anti-slop/no-runtime-typeof */

  return new MutationError(text, {
    cause, // the raw record is kept intact so Zero's `details` stay reachable
  });
}

/**
 * Read off the request: Zero stamps the dot-path onto the callable mutator
 * (`out/zql/src/mutate/mutator-registry.js:57`). A reverse lookup into the
 * registry would misname aliased mutators, so we never guess.
 */
function mutatorNameOf(request: MutateRequest<ReadonlyJSONValue | undefined, Schema>): string {
  // SAFETY: Zero stamps the mutator's dotted path onto the callable itself
  // (`out/zql/src/mutate/mutator-registry.js:57`); hand-rolled fake requests may omit it,
  // so the read is optional and the fallback label is explicit rather than guessed.
  const stamped = (request.mutator as { readonly mutatorName?: string } | undefined)?.mutatorName;

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- the stamped name is untrusted for fake requests; only a string is a usable label.
  return typeof stamped === "string" ? stamped : "anonymous";
}

/** The leg snapshot a mutator result implies; failures are branded at this boundary. */
function legFromDetails(details: MutatorResultDetails): MutationLegSnapshot {
  return details.type === "success"
    ? { status: "success", error: undefined }
    : { status: "error", error: brandError(details) };
}

/** Compose one channel with another: base first, then overlay; nothing if neither
 * exists. A throwing callback is reported and isolated — it never changes the published state or
 * the promises the caller awaits. */
function chainCallbacks<I>(
  base: ((info: I) => void) | undefined,
  overlay: ((info: I) => void) | undefined,
): ((info: I) => void) | undefined {
  const callbacks = [base, overlay].filter(
    (callback): callback is (info: I) => void => callback !== undefined,
  );

  if (callbacks.length === 0) {
    return undefined;
  }

  return (info) => {
    for (const callback of callbacks) {
      try {
        callback(info);
      } catch (error) {
        console.error("zero-bindings: a mutation callback threw", error);
      }
    }
  };
}

/** Compose the session's mutation defaults with one resource's own options. */
export function stackMutationOptions(
  defaults: MutationOptions | undefined,
  resource: MutationOptions | undefined,
): MutationOptions | undefined {
  if (!defaults) {
    return resource;
  }

  if (!resource) {
    return defaults;
  }

  return {
    timeout: resource.timeout ?? defaults.timeout,
    onSuccess: chainCallbacks(defaults.onSuccess, resource.onSuccess),
    onError: chainCallbacks(defaults.onError, resource.onError),
    onSettled: chainCallbacks(defaults.onSettled, resource.onSettled),
  };
}

/** One call's identity. It rides with the leg promises it belongs to: a settle carries
 * its own answer to "which call?", so delivery never reads current-call state. */
type MutationRun = {
  readonly mutatorName: string;
  readonly args: readonly unknown[];
};

function infoOf(run: MutationRun, kind: MutationKind): MutationInfo {
  return { mutatorName: run.mutatorName, kind, args: run.args };
}

export class MutationController<
  TMutator extends ZeroMutator,
  TSchema extends Schema = Schema,
  MD extends CustomMutatorDefs | undefined = CustomMutatorDefs | undefined,
  TContext extends BaseDefaultContext = BaseDefaultContext,
> implements MutationResource<TMutator> {
  readonly #getClient: () => Zero<TSchema, MD, TContext> | undefined;
  readonly #mutatorGetter: () => TMutator;
  readonly #callbacks: MutationCallbacks;
  readonly #timeout: number;
  readonly #store = new ObservableStore<MutationSnapshot>(IDLE_SNAPSHOT);
  #generation = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    getClient: () => Zero<TSchema, MD, TContext> | undefined,
    mutatorGetter: () => TMutator,
    options?: MutationOptions,
  ) {
    this.#getClient = getClient;
    this.#mutatorGetter = mutatorGetter;
    // Even a lone callback is composed through chainCallbacks: that is where the
    // isolation lives that keeps a throwing callback off the settle path.
    this.#callbacks = {
      onSuccess: chainCallbacks(options?.onSuccess, undefined),
      onError: chainCallbacks(options?.onError, undefined),
      onSettled: chainCallbacks(options?.onSettled, undefined),
    };
    this.#timeout = options?.timeout ?? DEFAULT_TIMEOUT_MS;
  }

  mutate(...args: Parameters<TMutator>): MutatorResult {
    if (this.#store.disposed) {
      throw new DisposedMutationError();
    }

    const client = this.#getClient();

    if (!client) {
      throw new ClientUnavailableError();
    }

    const mutator = this.#mutatorGetter();

    // The one required cast: a registry mutator's concrete request type into
    // the generic request shape `zero.mutate()` accepts.
    // SAFETY: the mutator's concrete signature is erased to the generic request shape
    // `zero.mutate()` takes; the request it builds is exactly that shape.
    /* oxlint-disable anti-slop/no-chained-type-assertions -- erasing a concrete function signature to an unrelated one cannot be a single assertion. */
    const request = (
      mutator as unknown as (
        ...args: readonly unknown[]
      ) => MutateRequest<ReadonlyJSONValue | undefined, Schema>
    )(...args);
    /* oxlint-enable anti-slop/no-chained-type-assertions */

    // SAFETY: `zero.mutate` is typed generically; it consumes the same request shape produced above.
    /* oxlint-disable anti-slop/no-chained-type-assertions -- erasing Zero's generic mutate to this concrete request signature cannot be a single assertion. */
    const result = (
      client.mutate as unknown as (
        request: MutateRequest<ReadonlyJSONValue | undefined, Schema>,
      ) => MutatorResult
    )(request);
    /* oxlint-enable anti-slop/no-chained-type-assertions */

    const generation = ++this.#generation;

    const run: MutationRun = {
      mutatorName: mutatorNameOf(request),
      args: [...args],
    };

    this.#clearTimer();

    // Configured is not reachable: while disconnected, Zero queues the mutation and
    // its server promise cannot settle — inside any timeout — exactly like a
    // serverless one's, so only a live `connected` leg is tracked and raced.
    const liveServer =
      client.server !== null && client.connection.state.current.name === "connected";

    this.#store.publish({
      client: { status: "pending", error: undefined },
      server: liveServer
        ? { status: "pending", error: undefined }
        : { status: "unavailable", error: undefined },
    });
    // An `unavailable` leg reports through the snapshot only: a leg that never
    // ran has no settle to deliver, and callbacks see real settles.
    const timeoutMs = this.#timeout;

    if (timeoutMs > 0) {
      this.#timer = setTimeout(() => {
        if (this.#stale(generation)) {
          return;
        }

        // Stop accepting late settles: the legs handled below are terminal.
        const timedOut = ++this.#generation;
        const error = new MutationTimeoutError(timeoutMs);

        for (const kind of MUTATION_KINDS) {
          if (this.#store.getSnapshot()[kind].status === "pending") {
            this.#land(timedOut, kind, { status: "error", error }, run);
          }
        }

        this.#clearTimer();
      }, timeoutMs);
    }

    this.#observe(generation, "client", result.client, run);

    if (liveServer) {
      this.#observe(generation, "server", result.server, run);
    }

    // A caller awaiting `.server` on a leg we just called terminal would hang until
    // `close()`; hand back the client promise so the result matches the snapshot.
    // Zero's own handler on the real server leg still fires (see the close() storm).
    return liveServer ? result : { client: result.client, server: result.client };
  }

  reset(): void {
    if (this.#store.disposed) {
      return;
    }

    this.#generation++;
    this.#clearTimer();
    this.#store.publish(IDLE_SNAPSHOT);
  }

  getSnapshot(): MutationSnapshot {
    return this.#store.getSnapshot();
  }

  subscribe(listener: () => void): () => void {
    return this.#store.subscribe(listener);
  }

  onDispose(listener: () => void): () => void {
    return this.#store.onDispose(listener);
  }

  dispose(): void {
    if (this.#store.disposed) {
      return;
    }

    this.#generation++;
    this.#clearTimer();
    this.#store.dispose();
  }

  /** True when a settle belongs to a superseded or disposed run. */
  #stale(generation: number): boolean {
    return this.#store.disposed || generation !== this.#generation;
  }

  /** Follows one leg's promise: lands the result, or the rejection as an error leg, for its call. */
  #observe(
    generation: number,
    kind: MutationKind,
    result: Promise<MutatorResultDetails>,
    run: MutationRun,
  ): void {
    void result.then(
      (details) => {
        this.#land(generation, kind, legFromDetails(details), run);
      },
      (cause: unknown) => {
        this.#land(generation, kind, { status: "error", error: brandError(cause) }, run);
      },
    );
  }

  /**
   * Lands one settled leg: publishes it, delivers the resource's callbacks, and
   * enforces the invariant that a failed client leg leaves no possible server outcome.
   */
  #land(generation: number, kind: MutationKind, leg: MutationLegSnapshot, run: MutationRun): void {
    if (this.#stale(generation)) {
      return;
    }

    if (kind === "server" && this.#store.getSnapshot().server.status === "unavailable") {
      return;
    }

    this.#settleLeg(kind, leg);

    if (leg.status === "success") {
      const info = infoOf(run, kind);
      this.#callbacks.onSuccess?.(info);
      this.#callbacks.onSettled?.(info);
    } else {
      const failed = { ...infoOf(run, kind), error: leg.error };
      this.#callbacks.onError?.(failed);
      this.#callbacks.onSettled?.(failed);
    }

    if (kind === "client" && leg.status === "error") {
      this.#markServerUnavailable(generation);
    } else {
      this.#maybeClearTimer();
    }
  }

  /** Publishes one leg, keeping the other leg's state. */
  #settleLeg(kind: MutationKind, leg: MutationLegSnapshot): void {
    const snapshot = this.#store.getSnapshot();
    this.#store.publish(
      kind === "client"
        ? { client: leg, server: snapshot.server }
        : { client: snapshot.client, server: leg },
    );
  }

  /** A failed client leg leaves no pending server work: the leg goes terminal in
   * the snapshot, without a callback — it never settled, it never ran. */
  #markServerUnavailable(generation: number): void {
    if (this.#store.disposed || generation !== this.#generation) {
      return;
    }

    if (this.#store.getSnapshot().server.status !== "pending") {
      this.#maybeClearTimer();

      return;
    }

    this.#settleLeg("server", { status: "unavailable", error: undefined });
    this.#maybeClearTimer();
  }

  #maybeClearTimer(): void {
    const snapshot = this.#store.getSnapshot();

    if (snapshot.client.status !== "pending" && snapshot.server.status !== "pending") {
      this.#clearTimer();
    }
  }

  #clearTimer(): void {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
  }
}
