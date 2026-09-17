import { createBuilder, defineQueriesWithType, defineQueryWithType } from "@rocicorp/zero";
import { schema } from "./schema.ts";

/** Query builder bound to the playground schema. */
export const zql = createBuilder(schema);

/**
 * Query registry handed to `createDefinitions`. `onlyOpen` arrives as a typed
 * argument: passing a getter that reads `$state` makes the query reactive —
 * the adapter's tracking effect re-resolves the key and core rematerializes.
 */
export const queries = defineQueriesWithType<typeof schema>()({
  todo: {
    list: defineQueryWithType<typeof schema>()(({ args }: { args: { onlyOpen: boolean } }) =>
      (args.onlyOpen ? zql.todo.where("done", false) : zql.todo)
        .orderBy("createdAt", "desc")
        .orderBy("id", "asc"),
    ),
  },
});
