import { createBuilder, defineQueriesWithType, defineQueryWithType } from "@rocicorp/zero";
import { schema } from "./schema.ts";

export const zql = createBuilder(schema);

export const queries = defineQueriesWithType<typeof schema>()({
  todo: {
    list: defineQueryWithType<typeof schema>()(({ args }: { args: { onlyOpen: boolean } }) =>
      (args.onlyOpen ? zql.todo.where("done", false) : zql.todo)
        .orderBy("createdAt", "desc")
        .orderBy("id", "asc"),
    ),
  },
});
