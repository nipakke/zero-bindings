import type {
  BaseDefaultContext,
  CustomMutatorDefs,
  HumanReadable,
  QueryOrQueryRequest,
  ReadonlyJSONValue,
  Schema,
  Zero,
} from "@rocicorp/zero";

/** How long one SSR `zero.run` may take before the render proceeds without data. */
export const SSR_RUN_TIMEOUT_MS = 10_000;

const TIMED_OUT = Symbol("zero-bindings/experimental_nuxt:ssr-timeout");

/**
 * Drops Zero's symbol-keyed row metadata (`refCountSymbol` et al.) so Nuxt's
 * payload serializer accepts the rows; JSON ignores symbol keys, so the round
 * trip changes nothing a consumer read through `HumanReadable`.
 */
export function stripZeroMetadata<T>(value: T): T {
  // SAFETY: a `zero.run` result is JSON by Zero's own contract (it is typed
  // `HumanReadable`), so the round trip preserves every readable field.
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Runs one query on the server and returns its rows, or `undefined` when the run
 * does not settle within `timeoutMs`: a request must never hang on a dead cache,
 * and no payload data is what the render proceeds with.
 *
 * `undefined` rather than an empty result is load-bearing in the browser, where
 * the same call backs the payload lookup: absent data falls back to the live
 * rows, while an empty array would stand in for a real empty result and blank a
 * live query that is still streaming.
 */
export async function runOnce<
  TSchema extends Schema,
  TTable extends keyof TSchema["tables"] & string,
  TContext extends BaseDefaultContext,
  TMutators extends CustomMutatorDefs | undefined,
  TInput extends ReadonlyJSONValue | undefined,
  TOutput extends ReadonlyJSONValue | undefined,
  TReturn,
>(
  zero: Zero<TSchema, TMutators, TContext>,
  query: QueryOrQueryRequest<TTable, TInput, TOutput, TSchema, TReturn, TContext>,
  timeoutMs: number = SSR_RUN_TIMEOUT_MS,
): Promise<HumanReadable<TReturn> | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const result = await Promise.race([
    zero.run(query, { type: "complete" }),
    new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
    }),
  ]);

  clearTimeout(timer);

  if (result === TIMED_OUT) {
    console.warn(
      `[zero-bindings/experimental_nuxt] zero.run() did not complete within ${timeoutMs}ms; rendering without SSR data`,
    );

    return undefined;
  }

  return stripZeroMetadata(result);
}
