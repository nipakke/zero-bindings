import type { ObservableResource } from "./types.ts";

/** Notifies over a set snapshot: a listener may unsubscribe or dispose mid-notify. */
function notify(listeners: Set<() => void>): void {
  // eslint-disable-next-line unicorn/no-useless-spread -- the copy is the point: notify the set as of entry
  for (const listener of [...listeners]) {
    listener();
  }
}

/**
 * The observable state behind every core resource: a cached value with
 * subscription, disposal listeners, and terminal idempotent disposal.
 *
 * `publish` keeps snapshots identity-stable — a value equal to the current one
 * is dropped, so consumers only re-render on a real transition. `reset` writes
 * without notifying, for lifecycle writes (terminal resets, pre-flush status
 * changes) that are not observable transitions.
 */
export class ObservableStore<T> implements ObservableResource<T> {
  #value: T;
  #subscribers = new Set<() => void>();
  #disposeListeners = new Set<() => void>();
  #disposed = false;

  constructor(value: T) {
    this.#value = value;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  getSnapshot(): T {
    return this.#value;
  }

  publish(value: T): void {
    if (this.#disposed || value === this.#value) {
      return;
    }

    this.#value = value;
    notify(this.#subscribers);
  }

  reset(value: T): void {
    this.#value = value;
  }

  subscribe(listener: () => void): () => void {
    if (this.#disposed) {
      return () => {};
    }

    this.#subscribers.add(listener);

    return () => {
      this.#subscribers.delete(listener);
    };
  }

  onDispose(listener: () => void): () => void {
    if (this.#disposed) {
      return () => {};
    }

    this.#disposeListeners.add(listener);

    return () => {
      this.#disposeListeners.delete(listener);
    };
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
    this.#subscribers.clear();
    notify(this.#disposeListeners);
    this.#disposeListeners.clear();
  }
}
