import { expect, test } from "vite-plus/test";
import { createBuilder, createSchema, number, relationships, string, table } from "@rocicorp/zero";
import { createTestZero } from "../fixtures/zero.ts";
import { rows } from "../fixtures/rows.ts";
import { createDefinitions } from "../../src/core/definitions.ts";
import { ZeroSession } from "../../src/core/session.ts";

const user = table("user").columns({ id: string(), name: string() }).primaryKey("id");

const issue = table("issue")
  .columns({ id: string(), title: string(), assigneeId: string().optional(), createdAt: number() })
  .primaryKey("id");

const issueRelationships = relationships(issue, ({ one }) => ({
  assignee: one({ sourceField: ["assigneeId"], destField: ["id"], destSchema: user }),
}));

const schema = createSchema({
  tables: [user, issue],
  relationships: [issueRelationships],
  enableLegacyMutators: true,
});

const zql = createBuilder(schema);

test("nested related-row updates reach a live session query", async () => {
  const client = createTestZero({ schema, userID: "related" });
  await client.mutate.user.insert({ id: "u1", name: "Bob" });
  await client.mutate.issue.insert({ id: "i1", title: "board", createdAt: 1 });

  const session = ZeroSession.create(createDefinitions({ schema }), { client });
  const resource = session.createQuery(() => zql.issue.related("assignee"));
  resource.start();

  expect(rows(resource.getSnapshot().data)).toEqual([
    { id: "i1", title: "board", assigneeId: null, createdAt: 1, assignee: undefined },
  ]);

  // Only the related row changes: the parent row keeps its columns and must
  // still surface the new assignee in the materialized snapshot.
  await client.mutate.issue.update({ id: "i1", assigneeId: "u1" });

  expect(rows(resource.getSnapshot().data)).toEqual([
    {
      id: "i1",
      title: "board",
      assigneeId: "u1",
      createdAt: 1,
      assignee: { id: "u1", name: "Bob" },
    },
  ]);
  session.dispose();
});
