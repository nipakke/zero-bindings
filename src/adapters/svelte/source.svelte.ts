import { untrack } from "svelte";
import type { Source } from "../../core/source.ts";

/** The adapter-facing input shape: a constant or a getter reading Svelte state. */
export type MaybeSource<T> = T | (() => T);

/** Resolves a {@link MaybeSource}: getters are called, constants pass through. */
export function resolveSource<T>(value: MaybeSource<T>): T {
  /* oxlint-disable anti-slop/no-runtime-typeof -- the boundary between a constant and a getter is a runtime representation the static type does not distinguish. */
  // SAFETY: the callable arm of `MaybeSource`; calling it yields its `T`.
  return typeof value === "function" ? (value as () => T)() : value;
  /* oxlint-enable anti-slop/no-runtime-typeof */
}

/**
 * Tracks a getter from outside the component tree. Each subscription owns a
 * root effect, so the unsubscribe handed back to core disposes it immediately
 * instead of waiting for the host component to die. The first run only records
 * the reads: core's contract is "a value may have changed", never an initial
 * replay. The listener runs untracked so core's own pulls can't re-enter this
 * effect's dependency set.
 */
function watch(read: () => void, listener: () => void): () => void {
  return $effect.root(() => {
    let first = true;
    $effect(() => {
      try {
        read();
      } catch {
        // A throwing getter still counts as a change: the reads before the
        // throw stay tracked, and core observes the throw itself via `get()`.
      }

      if (first) {
        first = false;
      } else {
        untrack(listener);
      }
    });
  });
}

/** Converts a constant/getter into the framework-neutral pull/subscribe source. */
export function toCoreSource<T>(value: MaybeSource<T>): Source<T> {
  /* oxlint-disable anti-slop/no-runtime-typeof -- the constant-vs-getter boundary is a runtime representation the static type does not distinguish. */
  return {
    get: () => resolveSource(value),
    subscribe: (listener: () => void): (() => void) =>
      // SAFETY: the callable arm of `MaybeSource`; the getter's reads are tracked by `watch`.
      typeof value === "function" ? watch(value as () => T, listener) : () => {},
  };
  /* oxlint-enable anti-slop/no-runtime-typeof */
}

/**
 * A source whose value is a query getter. `get()` hands core a stable thunk
 * that resolves the current query; `subscribe()` evaluates the same thunk
 * inside a tracking effect so the caller's reactive reads (any `$state` the
 * getter touches) drive rematerialization. Core's key comparison filters out
 * redundant restarts.
 */
export function toCoreQuerySource<T>(read: () => T): Source<() => T> {
  return {
    get: () => read,
    subscribe: (listener: () => void): (() => void) => watch(read, listener),
  };
}
