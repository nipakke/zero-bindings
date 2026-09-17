import { describe, expect, test } from "vite-plus/test";
import { ssrQueryKey } from "../../../src/adapters/nuxt/query-key.ts";
import { itemZql as zql } from "../../fixtures/item.ts";

describe("ssrQueryKey", () => {
  test("is stable for one query and namespaced", () => {
    expect(ssrQueryKey(zql.item)).toBe(ssrQueryKey(zql.item));
    expect(ssrQueryKey(zql.item)).toMatch(/^zero:/);
  });

  test("separates a query from its singular variant", () => {
    expect(ssrQueryKey(zql.item)).not.toBe(ssrQueryKey(zql.item.one()));
  });

  test("separates queries with different filters", () => {
    expect(ssrQueryKey(zql.item)).not.toBe(ssrQueryKey(zql.item.where("id", 1)));
  });
});
