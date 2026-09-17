export type Source<T> = {
  get(): T;
  subscribe(listener: () => void): () => void;
};

export type SourceInput<T> = T | Source<T>;

/** Default `subscribe`: a value that cannot change never notifies. */
const noSubscribe: () => () => void = () => () => {};

function isSource<T>(input: SourceInput<T>): input is Source<T> {
  /* oxlint-disable anti-slop/no-runtime-typeof -- this predicate is the pull/subscribe I/O boundary: it must decode an opaque `T | Source<T>` at runtime. */
  // SAFETY: the checks below are the predicate's own evidence — an object exposing callable `get` and `subscribe` is exactly the only shape `Source<T>` admits here.
  return (
    typeof input === "object" &&
    input !== null &&
    typeof (input as Source<T>).get === "function" &&
    typeof (input as Source<T>).subscribe === "function"
  );
  /* oxlint-enable anti-slop/no-runtime-typeof */
}

/**
 * Normalizes a {@link SourceInput} into a {@link Source}. Constant values
 * become sources whose `subscribe` is a no-op, so consumers can treat every
 * input uniformly.
 */
export function toSource<T>(input: SourceInput<T>): Source<T> {
  return isSource(input) ? input : createSource(() => input);
}

export function createSource<T>(
  get: () => T,
  subscribe?: (listener: () => void) => () => void,
): Source<T> {
  return { get, subscribe: subscribe ?? noSubscribe };
}

/** A source derived from another: reads are mapped, notifications forwarded. */
export function mapSource<T, U>(source: Source<T>, map: (value: T) => U): Source<U> {
  return createSource(
    () => map(source.get()),
    (listener) => source.subscribe(listener),
  );
}
