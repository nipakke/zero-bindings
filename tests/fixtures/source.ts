import { createSource } from "../../src/core/source.ts";

/**
 * A {@link Source} over a variable the test owns: `get` reads it, and `fire`
 * notifies the one subscriber after it changes. The hand-driven stand-in for a
 * framework ref or getter.
 */
export function signal<T>(get: () => T) {
  let notify = (): void => {};

  const source = createSource(get, (listener) => {
    notify = listener;

    return () => {};
  });

  return { source, fire: () => notify() };
}
