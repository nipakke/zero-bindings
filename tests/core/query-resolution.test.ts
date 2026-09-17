import { describe, expect, test } from "vite-plus/test";
import { createTestZero } from "../fixtures/zero.ts";
import { itemSchema as schema, itemZql as zql } from "../fixtures/item.ts";
import { plainError, resolveQuery } from "../../src/core/query-resolution.ts";

describe("resolveQuery", () => {
  test("a builder query resolves with client, hash, and many-shape in the key", () => {
    const z = createTestZero({ schema, userID: "test" });
    const resolved = resolveQuery(z, () => zql.item);
    expect(resolved.ok).toBe(true);

    if (!resolved.ok) return;
    expect(resolved.key.startsWith(`${z.clientID}:`)).toBe(true);
    expect(resolved.key.endsWith(":many")).toBe(true);
  });

  test("a singular query resolves with the one-shape in the key", () => {
    const z = createTestZero({ schema, userID: "test" });
    const resolved = resolveQuery(z, () => zql.item.one());
    expect(resolved.ok).toBe(true);

    if (!resolved.ok) return;
    expect(resolved.key.endsWith(":one")).toBe(true);
  });

  test("a falsy signal resolves as disabled", () => {
    const z = createTestZero({ schema, userID: "test" });
    expect(resolveQuery(z, () => undefined)).toEqual({ ok: false, kind: "disabled" });
  });

  test("a throwing signal resolves as QuerySignalError", () => {
    const z = createTestZero({ schema, userID: "test" });

    const resolved = resolveQuery(z, () => {
      throw new Error("signal boom");
    });

    expect(resolved).toEqual({
      ok: false,
      kind: "error",
      error: { type: "QuerySignalError", message: "signal boom" },
    });
  });

  test("a branded QueryError thrown by the signal keeps its own type", () => {
    const z = createTestZero({ schema, userID: "test" });

    const resolved = resolveQuery(z, () => {
      // SAFETY: a hand-rolled branded error: the resolver must recognize it at
      // runtime, so the thrown value deliberately bypasses its type.
      throw { type: "InvalidQuery", message: "branded", details: { code: 1 } } as never;
    });

    if (resolved.ok || resolved.kind !== "error") {
      throw new Error("expected an error resolution for a throwing signal");
    }

    expect(resolved.error).toEqual({
      type: "InvalidQuery",
      message: "branded",
      details: { code: 1 },
    });
  });

  test("a signal resolving to a non-query resolves as InvalidQuery", () => {
    const z = createTestZero({ schema, userID: "test" });
    // A getter that hands back the wrong shape must surface as an error
    // snapshot, not a crash.
    // SAFETY: the getter deliberately resolves to a non-query; `resolveQuery`'s
    // runtime guard is what rejects it.
    const resolved = resolveQuery(z, () => "not a query" as never);

    if (resolved.ok || resolved.kind !== "error") {
      throw new Error("expected an error resolution for a non-query signal value");
    }

    expect(resolved.error.type).toBe("InvalidQuery");
    expect(resolved.error.message).toMatch(/\S/);
  });

  test("the key distinguishes clients and query identity", () => {
    const z1 = createTestZero({ schema, userID: "a" });
    const z2 = createTestZero({ schema, userID: "b" });
    const one = resolveQuery(z1, () => zql.item);
    const sameQuery = resolveQuery(z1, () => zql.item);
    const otherClient = resolveQuery(z2, () => zql.item);
    const filtered = resolveQuery(z1, () => zql.item.where("name", "foo"));

    if (!one.ok || !sameQuery.ok || !otherClient.ok || !filtered.ok) {
      throw new Error("expected all resolutions to be ok");
    }

    expect(one.key).toBe(sameQuery.key);
    expect(one.key).not.toBe(otherClient.key);
    expect(one.key).not.toBe(filtered.key);
  });
});

describe("plainError", () => {
  test("an Error is labeled with the caller's type", () => {
    expect(plainError("CallerType", new Error("boom"))).toEqual({
      type: "CallerType",
      message: "boom",
    });
  });

  test("a branded QueryError keeps its own type, message, and details", () => {
    expect(
      plainError("CallerType", { type: "InvalidQuery", message: "bad", details: { code: 7 } }),
    ).toEqual({ type: "InvalidQuery", message: "bad", details: { code: 7 } });
  });

  test("a branded QueryError without details gets no details key", () => {
    const error = plainError("CallerType", { type: "InvalidMutator", message: "nope" });
    expect(error).toEqual({ type: "InvalidMutator", message: "nope" });
    expect("details" in error).toBe(false);
  });

  test("non-object throws stringify into the caller's type", () => {
    expect(plainError("CallerType", "just a string")).toEqual({
      type: "CallerType",
      message: "just a string",
    });
    expect(plainError("CallerType", null)).toEqual({ type: "CallerType", message: "null" });
    // Objects that do not carry string type/message are not QueryErrors.
    expect(plainError("CallerType", { message: "no type" })).toEqual({
      type: "CallerType",
      message: "[object Object]",
    });
    expect(plainError("CallerType", { type: 5, message: "type not a string" })).toEqual({
      type: "CallerType",
      message: "[object Object]",
    });
  });
});
