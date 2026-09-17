import {
  type Change,
  type Entry,
  type ErroredQuery,
  type Format,
  type HumanReadable,
  type Input,
  type Output,
  type Query,
  type Schema,
  type Stream,
  type TTL,
} from "@rocicorp/zero";
import { applyChange, skipYields, type ViewChange } from "@rocicorp/zero/bindings";
import { ObservableStore } from "./observable-store.ts";
import type { QueryError, QuerySnapshot, QueryStatus } from "./types.ts";

/** Statuses a live view can report (no `"disabled"` — that's the no-view state). */
type ViewStatus = Exclude<QueryStatus, "disabled">;

/** The schema type `Input` hands out (not publicly exported by Zero). */
type SourceSchema = ReturnType<Input["getSchema"]>;

/** The shared empty yield stream returned by `push` (no yields are ever emitted). */
// SAFETY: no `yield` element is ever produced, so the empty array is a valid `Stream<"yield">`.
const EMPTY_STREAM = [] as Stream<"yield">;

/** Maps a raw IVM `Change` tuple to the `ViewChange` shape `applyChange` consumes. */
function changeToViewChange(change: Change): ViewChange {
  switch (change[0]) {
    case 0: // ADD
      return { type: "add", node: change[1] };
    case 1: // REMOVE
      return { type: "remove", node: change[1] };
    case 2: // EDIT
      return { type: "edit", node: change[1], oldNode: change[2] };
    case 3: // CHILD
      return {
        type: "child",
        node: change[1],
        child: {
          relationshipName: change[2].relationshipName,
          change: changeToViewChange(change[2].change),
        },
      };
    default: {
      const _exhaustive: never = change[0];
      throw new Error(`Unknown change type: ${String(_exhaustive)}`);
    }
  }
}

/** Whether a materialize completion is a reported failure record rather than a pending promise. */
function isReportedFailure(value: true | ErroredQuery | Promise<true>): value is ErroredQuery {
  /* oxlint-disable anti-slop/no-runtime-typeof -- this predicate inspects the runtime-reported error channel Zero feeds the factory. */
  return typeof value === "object" && value !== null && "error" in value;
  /* oxlint-enable anti-slop/no-runtime-typeof */
}

/** Whether an arbitrary thrown/reported value is a Zero query-error record. */
function isErroredQuery(value: unknown): value is ErroredQuery {
  /* oxlint-disable anti-slop/no-runtime-typeof -- thrown-value I/O boundary: an arbitrary cause is decoded into the ErroredQuery shape at runtime. */
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
  );
  /* oxlint-enable anti-slop/no-runtime-typeof */
}

/** Normalizes a Zero query error (thrown or reported) into the snapshot shape. */
function toViewError(cause: unknown): QueryError {
  if (cause instanceof Error) {
    return { type: cause.name, message: cause.message };
  }

  if (isErroredQuery(cause)) {
    const message = cause.message ?? "An unknown error occurred";

    if (!cause.details) {
      return { type: cause.error, message };
    }

    return { type: cause.error, message, details: cause.details };
  }

  return { type: "UnknownError", message: "An unknown error occurred" };
}

/**
 * A framework-neutral materialized view, produced by `zero.materialize(query,
 * observableViewFactory, options)`.
 *
 * Implements Zero's `Output` view contract (the same pattern as its built-in
 * `ArrayView`): it reads the initial result via `input.fetch()`, applies
 * incremental `push()` changes, and flushes on transaction commit. Consumers
 * read via `getSnapshot()` and observe via `subscribe()` (React
 * `useSyncExternalStore`-compatible). `destroy()` is terminal and runs the
 * on-destroy hook zero passed to the factory.
 */
export class ObservableView<TReturn> implements Output {
  readonly #input: Input;
  readonly #schema!: SourceSchema;
  readonly #format: Format;
  readonly #updateTTL: (ttl: TTL) => void;
  readonly #store: ObservableStore<QuerySnapshot<HumanReadable<TReturn>>>;
  #root: Entry;
  #dirty = false;
  #txnDirty = new WeakSet<object>();

  constructor(
    input: Input,
    format: Format,
    onDestroy: () => void,
    onTransactionCommit: (cb: () => void) => void,
    queryComplete: true | ErroredQuery | Promise<true>,
    updateTTL: (ttl: TTL) => void,
  ) {
    this.#input = input;
    this.#format = format;
    this.#updateTTL = updateTTL;
    // Synthetic "root" entry with a single "" relationship, mirroring ArrayView.
    this.#root = { "": format.singular ? undefined : [] };
    // SAFETY: the synthetic root's "" relationship holds the view's initial data, typed by the query's return.
    this.#store = new ObservableStore<QuerySnapshot<HumanReadable<TReturn>>>({
      data: this.#root[""] as HumanReadable<TReturn> | undefined,
      status: "unknown",
      error: undefined,
    });
    this.#store.onDispose(onDestroy);

    // The Input and its commit hook are zero-owned — any throw must settle
    // into `status: 'error'` instead of escaping the constructor (which would
    // crash the materialize caller).
    try {
      this.#schema = input.getSchema();
      input.setOutput(this);
      onTransactionCommit(() => {
        if (this.#store.disposed) {
          return;
        }

        try {
          this.#flush();
        } catch (e) {
          this.#setError(e);
        }
      });

      this.#handleQueryComplete(queryComplete);
      this.#hydrate();
    } catch (e) {
      this.#setError(e);
    }
  }

  getSnapshot(): QuerySnapshot<HumanReadable<TReturn>> {
    return this.#store.getSnapshot();
  }

  subscribe(listener: () => void): () => void {
    return this.#store.subscribe(listener);
  }

  #handleQueryComplete(queryComplete: true | ErroredQuery | Promise<true>): void {
    if (queryComplete === true) {
      // The rows are still being fetched, so this status write is not a
      // transition any consumer could observe yet.
      this.#store.reset(this.#withStatus("complete"));
    } else if (isReportedFailure(queryComplete)) {
      this.#store.reset(this.#withStatus("error", toViewError(queryComplete)));
    } else {
      void queryComplete
        .then(() => {
          if (!this.#store.disposed) {
            this.#store.publish(this.#withStatus("complete"));
          }
        })
        .catch((e: ErroredQuery) => {
          if (!this.#store.disposed) {
            this.#setError(e);
          }
        });
    }
  }

  #hydrate(): void {
    try {
      this.#dirty = true;

      for (const node of skipYields(this.#input.fetch({}))) {
        this.#root = applyChange(
          this.#root,
          { type: "add", node },
          this.#schema,
          "",
          this.#format,
          false /* withIDs */,
          true /* mutate: fresh root not yet observed by any consumer */,
        );
      }

      this.#flush();
    } catch (e) {
      // A throwing fetch must not escape the view (nor the materialize call):
      // settle into the error snapshot and keep the view alive for retry.
      this.#setError(e);
    }
  }

  push(change: Change): Stream<"yield"> {
    if (this.#store.disposed) {
      return EMPTY_STREAM;
    }

    try {
      this.#dirty = true;
      this.#root = applyChange(
        this.#root,
        changeToViewChange(change),
        this.#schema,
        "",
        this.#format,
        false /* withIDs */,
        this.#txnDirty /* mutate: copy-on-write within this transaction */,
      );
    } catch (e) {
      // A throwing applyChange must not escape into Zero's commit machinery:
      // settle into the error snapshot and let the consumer render the error.
      this.#setError(e);
    }

    return EMPTY_STREAM;
  }

  updateTTL(ttl: TTL): void {
    this.#updateTTL(ttl);
  }

  /** Terminal teardown: releases the view's consumers and runs zero's on-destroy hook. */
  destroy(): void {
    this.#store.dispose();
  }

  /** The snapshot that keeps the current rows and takes the given status. */
  #withStatus(status: ViewStatus, error?: QueryError): QuerySnapshot<HumanReadable<TReturn>> {
    return { data: this.#store.getSnapshot().data, status, error };
  }

  #setError(cause: unknown): void {
    this.#store.publish(this.#withStatus("error", toViewError(cause)));
  }

  #flush(): void {
    if (!this.#dirty) {
      return;
    }

    this.#dirty = false;
    const current = this.#store.getSnapshot();

    // SAFETY: the synthetic root's "" relationship holds the flushed view data, typed by the query's return.
    const snapshot: QuerySnapshot<HumanReadable<TReturn>> = {
      data: this.#root[""] as HumanReadable<TReturn> | undefined,
      status: current.status,
      error: current.error,
    };

    this.#txnDirty = new WeakSet();
    this.#store.publish(snapshot);
  }
}

/**
 * View factory for `zero.materialize(query, observableViewFactory, options)`
 * that produces an {@link ObservableView}.
 */
export function observableViewFactory<
  TTable extends keyof TSchema["tables"] & string,
  TSchema extends Schema,
  TReturn,
>(
  _query: Query<TTable, TSchema, TReturn>,
  input: Input,
  format: Format,
  onDestroy: () => void,
  onTransactionCommit: (cb: () => void) => void,
  queryComplete: true | ErroredQuery | Promise<true>,
  updateTTL: (ttl: TTL) => void,
): ObservableView<TReturn> {
  return new ObservableView(
    input,
    format,
    onDestroy,
    onTransactionCommit,
    queryComplete,
    updateTTL,
  );
}
