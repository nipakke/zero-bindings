import { createBuilder, defineQueriesWithType, defineQueryWithType } from "@rocicorp/zero";
import { schema, type AppSchema } from "./schema.ts";

/** Query builder bound to the playground schema. */
export const zql = createBuilder(schema);

const defineAppQuery = defineQueryWithType<AppSchema>();

/** Registry query used by the page; changing `onlyOpen` rematerializes it. */
export const queries = defineQueriesWithType<AppSchema>()({
  todo: {
    list: defineAppQuery(({ args }: { args: { onlyOpen: boolean } }) =>
      (args.onlyOpen ? zql.todo.where("done", false) : zql.todo)
        .orderBy("createdAt", "desc")
        .orderBy("id", "asc"),
    ),
  },
});
