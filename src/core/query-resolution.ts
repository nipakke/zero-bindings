import type {
  BaseDefaultContext,
  CustomMutatorDefs,
  Falsy,
  Query,
  QueryOrQueryRequest,
  ReadonlyJSONValue,
  Schema,
  Zero,
} from "@rocicorp/zero";
import { addContextToQuery, asQueryInternals } from "@rocicorp/zero/bindings";
import type { QueryError } from "./types.ts";

/**
 * The query shape a bound getter resolves to: a Zero query or query request, or
 * a falsy value that disables the resource.
 */
export type QuerySignalQuery<
  TSchema extends Schema,
  TTable extends keyof TSchema["tables"] & string,
  TReturn,
  TContext extends BaseDefaultContext,
  TInput extends ReadonlyJSONValue | undefined = ReadonlyJSONValue | undefined,
  TOutput extends ReadonlyJSONValue | undefined = ReadonlyJSONValue | undefined,
> = QueryOrQueryRequest<TTable, TInput, TOutput, TSchema, TReturn, TContext> | Falsy;

export type QueryResolution<
  TSchema extends Schema,
  TTable extends keyof TSchema["tables"] & string,
  TReturn,
> =
  | { readonly ok: true; readonly query: Query<TTable, TSchema, TReturn>; readonly key: string }
  | { readonly ok: false; readonly kind: "disabled" }
  | { readonly ok: false; readonly kind: "error"; readonly error: QueryError };

/**
 * Resolves a query signal against a client: reads the signal, converts a query
 * request into a query with the client's context, and derives the identity key
 * that tells two materializations apart (client, query hash, and shape).
 */
export function resolveQuery<
  TSchema extends Schema,
  TTable extends keyof TSchema["tables"] & string,
  TReturn,
  TContext extends BaseDefaultContext = BaseDefaultContext,
  TMutators extends CustomMutatorDefs | undefined = undefined,
  TInput extends ReadonlyJSONValue | undefined = ReadonlyJSONValue | undefined,
  TOutput extends ReadonlyJSONValue | undefined = ReadonlyJSONValue | undefined,
>(
  zero: Zero<TSchema, TMutators, TContext>,
  signal: () => QuerySignalQuery<TSchema, TTable, TReturn, TContext, TInput, TOutput>,
): QueryResolution<TSchema, TTable, TReturn> {
  let value: QuerySignalQuery<TSchema, TTable, TReturn, TContext, TInput, TOutput>;

  try {
    value = signal();
  } catch (error) {
    return { ok: false, kind: "error", error: plainError("QuerySignalError", error) };
  }

  if (!value) {
    return { ok: false, kind: "disabled" };
  }

  try {
    // Passes a query through and turns a query request into one under `zero.context`.
    const query = addContextToQuery(value, zero.context);
    const internals = asQueryInternals(query);

    return {
      ok: true,
      query,
      key: `${zero.clientID}:${internals.hash()}:${internals.format.singular ? "one" : "many"}`,
    };
  } catch (error) {
    return { ok: false, kind: "error", error: plainError("InvalidQuery", error) };
  }
}

/**
 * Normalizes a thrown value into a plain snapshot error. A thrown
 * {@link QueryError} (a resolver's `InvalidQuery`/`InvalidMutator`) keeps its
 * own type and message; anything else is labeled with the caller's `type`.
 */
export function plainError(type: string, cause: unknown): QueryError {
  if (cause instanceof Error) {
    return { type, message: cause.message };
  }

  if (isQueryError(cause)) {
    if (cause.details === undefined) {
      return { type: cause.type, message: cause.message };
    }

    return { type: cause.type, message: cause.message, details: cause.details };
  }

  return { type, message: String(cause) };
}

function isQueryError(value: unknown): value is QueryError {
  /* oxlint-disable anti-slop/no-runtime-typeof -- this predicate is the thrown-value I/O boundary: it must decode an arbitrary cause into the QueryError shape at runtime. */
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return (
    "type" in value &&
    typeof value.type === "string" &&
    "message" in value &&
    typeof value.message === "string"
  );
  /* oxlint-enable anti-slop/no-runtime-typeof */
}
