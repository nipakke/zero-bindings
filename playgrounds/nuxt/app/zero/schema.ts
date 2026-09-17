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
 * `enableLegacyMutators` keeps table-scoped inserts available to the browser
 * seeder alongside the registry mutators used by the page.
 */
export const schema = createSchema({
  tables: [todo],
  enableLegacyMutators: true,
});

export type AppSchema = typeof schema;
