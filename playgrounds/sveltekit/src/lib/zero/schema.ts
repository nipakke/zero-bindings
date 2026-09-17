import { boolean, createSchema, number, string, table } from "@rocicorp/zero";

export const todo = table("todo")
  .columns({
    id: string(),
    title: string(),
    done: boolean(),
    createdAt: number(),
  })
  .primaryKey("id");

/**
 * `enableLegacyMutators` keeps the table-scoped CRUD helpers
 * (`client.mutate.todo.insert(…)`) available alongside the `defineMutators`
 * registry the UI writes through — the seed routine uses them.
 */
export const schema = createSchema({
  tables: [todo],
  enableLegacyMutators: true,
});

export type AppSchema = typeof schema;
