import type { ObservableResource } from "../../src/core/types.ts";

/** The observer shape this fixture mirrors: snapshot reads plus change notices. */
type Observable<T> = Pick<ObservableResource<T>, "getSnapshot" | "subscribe">;

/** What a mirrored sink publishes: every snapshot seen, and the stop handle. */
export type Mirror<T> = {
  readonly seen: T[];
  readonly stop: () => void;
};

/**
 * A mirrored plain-JS sink: records every snapshot the resource publishes,
 * starting from the current one. No framework, no store library — this is the
 * host-neutral stand-in for an adapter mirror (the Vue mirror of
 * `bindQueryResource`/`bindMutationResource` is the shipped real one).
 */
export function mirror<T>(resource: Observable<T>): Mirror<T> {
  const seen: T[] = [resource.getSnapshot()];

  const unsubscribe = resource.subscribe(() => {
    seen.push(resource.getSnapshot());
  });

  return { seen, stop: unsubscribe };
}
