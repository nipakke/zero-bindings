import { boolean, createSchema, number, string, table } from "@rocicorp/zero";

export const todo = table("todo")
  .columns({
    id: string(),
    title: string(),
    done: boolean(),
    createdAt: number(),
  })
  .primaryKey("id");

export const schema = createSchema({
  tables: [todo],
  enableLegacyMutators: true,
});

export type AppSchema = typeof schema;
