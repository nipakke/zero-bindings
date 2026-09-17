import { describe, expect, test } from "vite-plus/test";
import { runOnce, stripZeroMetadata } from "../../../src/adapters/nuxt/ssr-run.ts";
import { itemSchema as schema, itemZql as zql } from "../../fixtures/item.ts";
import { createTestZero } from "../../fixtures/zero.ts";

describe("runOnce", () => {
  test("a run that never completes yields no payload data", async () => {
    const z = createTestZero({ schema, userID: "test" });

    // `{ type: "complete" }` waits for a server this client does not have.
    await expect(runOnce(z, zql.item, 5)).resolves.toBeUndefined();
  });
});

describe("stripZeroMetadata", () => {
  test("drops Zero's row metadata but keeps every row field", async () => {
    const z = createTestZero({ schema, userID: "test" });
    await z.mutate.item.insert({ id: 1, name: "foo" });

    const local = await z.run(zql.item);
    expect(Object.getOwnPropertySymbols(local[0])).not.toHaveLength(0);

    const payload = stripZeroMetadata(local);
    expect(Object.getOwnPropertySymbols(payload[0])).toHaveLength(0);
    expect(payload).toEqual([{ id: 1, name: "foo" }]);
  });
});
