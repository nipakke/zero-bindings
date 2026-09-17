import { isProxy, toRaw, toValue, watch, type MaybeRefOrGetter } from "vue";
import type { Source } from "../../core/source.ts";

function raw<T>(value: T): T {
  return isProxy(value) ? toRaw(value) : value;
}

const UNREADABLE = Symbol("zero-bindings/vue:unreadable-source");

/** Converts a Vue ref/getter into the framework-neutral pull/subscribe source. */
export function toCoreSource<T>(value: MaybeRefOrGetter<T>): Source<T> {
  const get = (): T => raw(toValue(value));

  const subscribe = (listener: () => void): (() => void) =>
    watch(
      () => {
        try {
          return raw(toValue(value));
        } catch {
          return UNREADABLE;
        }
      },
      () => listener(),
    );

  return { get, subscribe };
}

/**
 * A source whose value is a getter. `get()` hands core a stable thunk that
 * resolves the current query; `subscribe()` evaluates the same thunk inside a
 * Vue watcher so the caller's reactive reads are tracked. Evaluation failures
 * yield `undefined` for tracking only; core still observes the throw via `get()`.
 *
 * Note: the watcher must return the evaluated query — a constant `undefined`
 * return would make Vue's `hasChanged` suppress every callback. The evaluated
 * query is a fresh identity per re-evaluation; core's key comparison filters
 * out redundant restarts.
 */
export function toCoreQuerySource<T>(read: () => T): Source<() => T> {
  const evaluate = (): T => raw(read());

  return {
    get: () => evaluate,
    subscribe: (listener: () => void): (() => void) =>
      watch(
        () => {
          try {
            return evaluate();
          } catch {
            return undefined;
          }
        },
        () => listener(),
      ),
  };
}
