import type { Query, Schema } from "@rocicorp/zero";
import { asQueryInternals } from "@rocicorp/zero/bindings";

/**
 * The SSR payload key for one resolved query: Zero's query hash plus whether the
 * query returns one row or many. Deliberately excludes `clientID` — the server
 * and browser clients are different instances and must find the same payload
 * entry. The `<one|many>` half matters because a query and its `.one()` variant
 * share a hash and would otherwise collide in the payload.
 */
export function ssrQueryKey<
  TSchema extends Schema,
  TTable extends keyof TSchema["tables"] & string,
  TReturn,
>(query: Query<TTable, TSchema, TReturn>): string {
  const internals = asQueryInternals(query);

  return `zero:${internals.hash()}:${internals.format.singular ? "one" : "many"}`;
}
