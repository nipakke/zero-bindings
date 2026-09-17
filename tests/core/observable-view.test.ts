import { describe, expect, test } from "vite-plus/test";
import { createTestZero } from "../fixtures/zero.ts";
import { itemSchema as schema, itemZql as zql } from "../fixtures/item.ts";
import { rows } from "../fixtures/rows.ts";
import { ObservableView, observableViewFactory } from "../../src/core/observable-view.ts";

describe("ObservableView", () => {
  test("exposes snapshot data, status, and error from a materialized view", async () => {
    const z = createTestZero({ schema, userID: "test" });
    const query = zql.item;

    // SAFETY: materialize returns the view this factory builds, so the runtime type is
    // ObservableView; the row type is unknown because these assertions only read snapshot shape.
    const view = z.materialize(query, observableViewFactory) as ObservableView<unknown>;

    expect(view.getSnapshot().data).toBeDefined();
    expect(view.getSnapshot().status).toBe("unknown");
    expect(view.getSnapshot().error).toBeUndefined();
    view.updateTTL("10m");

    await z.mutate.item.insert({ id: 1, name: "foo" });

    expect(rows(view.getSnapshot().data)).toEqual([{ id: 1, name: "foo" }]);
    // Local-only zero never completes a sync (server: null), so status stays 'unknown'.
    expect(view.getSnapshot().status).toBe("unknown");
    view.destroy();
  });

  test("notifies one subscriber per transaction and keeps snapshot identity between flushes", async () => {
    const z = createTestZero({ schema, userID: "test" });
    const query = zql.item;

    // SAFETY: materialize returns the view this factory builds, so the runtime type is
    // ObservableView; the row type is unknown because these assertions only read snapshot shape.
    const view = z.materialize(query, observableViewFactory) as ObservableView<unknown>;
    let calls = 0;
    const before = view.getSnapshot();
    view.subscribe(() => {
      calls++;
    });

    await z.mutate.item.insert({ id: 1, name: "foo" });

    expect(calls).toBe(1);
    expect(view.getSnapshot()).not.toBe(before);
    const afterInsert = view.getSnapshot();
    view.subscribe(() => {});
    expect(view.getSnapshot()).toBe(afterInsert);
    view.destroy();
  });

  test("stops updating after destroy", async () => {
    const z = createTestZero({ schema, userID: "test" });
    const query = zql.item;

    // SAFETY: materialize returns the view this factory builds, so the runtime type is
    // ObservableView; the row type is unknown because these assertions only read snapshot shape.
    const view = z.materialize(query, observableViewFactory) as ObservableView<unknown>;
    let calls = 0;
    view.subscribe(() => {
      calls++;
    });
    view.destroy();
    let lateCalls = 0;

    const late = view.subscribe(() => {
      lateCalls++;
    });

    late();
    expect(lateCalls).toBe(0);

    await z.mutate.item.insert({ id: 1, name: "foo" });

    expect(rows(view.getSnapshot().data)).toEqual([]);
    expect(calls).toBe(0);
  });

  test("handles singular queries as a single row", async () => {
    const z = createTestZero({ schema, userID: "test" });
    const query = zql.item.one();

    // SAFETY: materialize returns the view this factory builds, so the runtime type is
    // ObservableView; the row type is unknown because these assertions only read snapshot shape.
    const view = z.materialize(query, observableViewFactory) as ObservableView<unknown>;

    await z.mutate.item.insert({ id: 1, name: "foo" });

    expect(rows(view.getSnapshot().data)).toEqual({ id: 1, name: "foo" });
    view.destroy();
  });

  test("handles empty singular queries as undefined", async () => {
    const z = createTestZero({ schema, userID: "test" });
    const query = zql.item.one();

    // SAFETY: materialize returns the view this factory builds, so the runtime type is
    // ObservableView; the row type is unknown because these assertions only read snapshot shape.
    const view = z.materialize(query, observableViewFactory) as ObservableView<unknown>;

    expect(view.getSnapshot().data).toBeUndefined();
    view.destroy();
  });

  test("a completing queryComplete promise publishes complete", async () => {
    let resolveComplete!: (v: true) => void;

    const pending = new Promise<true>((resolve) => {
      resolveComplete = resolve;
    });

    // SAFETY: the stub Input and hooks below implement only what this test exercises;
    // the casts restore the zero types those partial stand-ins replace.
    const view = new ObservableView(
      {
        getSchema: () => ({}) as never,
        fetch: () => [] as never,
        setOutput: () => {},
        destroy: () => {},
      } as never,
      { singular: false, relationships: {} },
      () => {},
      () => {},
      pending,
      () => {},
    );

    expect(view.getSnapshot().status).toBe("unknown");
    resolveComplete(true);
    await pending;
    await Promise.resolve();
    expect(view.getSnapshot().status).toBe("complete");
    view.destroy();
  });

  test("a rejecting queryComplete promise settles into the error snapshot", async () => {
    const rejecting = Promise.reject({
      error: "app" as const,
      id: "test-id",
      name: "test-query",
      message: "query died",
      details: { code: 42 },
    });

    // SAFETY: the stub Input and hooks below implement only what this test exercises;
    // the casts restore the zero types those partial stand-ins replace.
    const view = new ObservableView(
      {
        getSchema: () => ({}) as never,
        fetch: () => [] as never,
        setOutput: () => {},
        destroy: () => {},
      } as never,
      { singular: false, relationships: {} },
      () => {},
      () => {},
      rejecting,
      () => {},
    );

    await rejecting.catch(() => {});
    await Promise.resolve();
    expect(view.getSnapshot().status).toBe("error");
    expect(view.getSnapshot().error).toMatchObject({
      type: "app",
      message: "query died",
      details: { code: 42 },
    });
    view.destroy();
  });

  test("a throwing input.getSchema settles into the error snapshot, not the constructor", () => {
    // SAFETY: the stub Input and hooks below implement only what this test exercises;
    // the casts restore the zero types those partial stand-ins replace.
    const view = new ObservableView(
      {
        getSchema: () => {
          throw new Error("schema boom");
        },
        fetch: () => [] as never,
        setOutput: () => {},
        destroy: () => {},
      } as never,
      { singular: false, relationships: {} },
      () => {},
      () => {},
      true,
      () => {},
    );

    expect(view.getSnapshot().status).toBe("error");
    expect(view.getSnapshot().error).toMatchObject({ type: "Error", message: "schema boom" });
    view.destroy();
  });

  test("a push after destroy is inert", async () => {
    const z = createTestZero({ schema, userID: "test" });
    // SAFETY: materialize returns the view this factory builds, so the runtime type is
    // ObservableView; the row type is unknown because these assertions only read snapshot shape.
    const view = z.materialize(zql.item, observableViewFactory) as ObservableView<unknown>;
    await z.mutate.item.insert({ id: 1, name: "foo" });
    expect(rows(view.getSnapshot().data)).toEqual([{ id: 1, name: "foo" }]);
    view.destroy();
    // Zero never pushes to a destroyed view; if it did, the view must stay inert.
    // SAFETY: the tuple is deliberately not a `Change`; push() must ignore it without type help.
    expect(view.push([1, { id: 2, name: "late" }, null] as never)).toEqual([]);
    expect(rows(view.getSnapshot().data)).toEqual([{ id: 1, name: "foo" }]);
    expect(view.getSnapshot().status).toBe("unknown");
  });

  test("surfaces error status and payload when queryComplete is an ErroredQuery", () => {
    const erroredQuery = {
      error: "app" as const,
      id: "test-id",
      name: "test-query",
      message: "Something went wrong",
      details: { code: 42 },
    };

    // SAFETY: the stub Input and hooks below implement only what this test exercises;
    // the casts restore the zero types those partial stand-ins replace.
    const view = new ObservableView(
      {
        getSchema: () => ({}) as never,
        fetch: () => [] as never,
        setOutput: () => {},
        destroy: () => {},
      } as never,
      { singular: false, relationships: {} },
      () => {},
      () => {},
      erroredQuery,
      () => {},
    );

    expect(view.getSnapshot().status).toBe("error");
    expect(view.getSnapshot().error).toMatchObject({
      type: "app",
      message: "Something went wrong",
      details: { code: 42 },
    });
    view.destroy();
  });

  test("unknown change-type push settles into the error snapshot, never throws", () => {
    const z = createTestZero({ schema, userID: "test" });
    const query = zql.item;
    // SAFETY: materialize returns the view this factory builds, so the runtime type is
    // ObservableView; the row type is unknown because these assertions only read snapshot shape.
    const view = z.materialize(query, observableViewFactory) as ObservableView<unknown>;

    // SAFETY: the tuple is deliberately not a `Change`; it exists to prove an unknown
    // change type settles into the error snapshot rather than throwing.
    const badChange = [99, { id: 1, name: "x" }, null] as never;

    expect(() => view.push(badChange)).not.toThrow();
    expect(view.getSnapshot().status).toBe("error");
    expect(view.getSnapshot().error?.message).toContain("Unknown change type");
    expect(view.getSnapshot().error?.type).toBe("Error");
    view.destroy();
  });

  test("a throwing input.fetch() settles into the error snapshot, not the constructor", () => {
    // SAFETY: the stub Input and hooks below implement only what this test exercises;
    // the casts restore the zero types those partial stand-ins replace.
    const view = new ObservableView(
      {
        getSchema: () => ({}) as never,
        fetch: () => {
          throw new Error("fetch boom");
        },
        setOutput: () => {},
        destroy: () => {},
      } as never,
      { singular: false, relationships: {} },
      () => {},
      () => {},
      true,
      () => {},
    );

    expect(view.getSnapshot().status).toBe("error");
    expect(view.getSnapshot().error).toMatchObject({ type: "Error", message: "fetch boom" });
    expect(view.getSnapshot().data).toEqual([]);
    view.destroy();
  });

  test("unsubscribe is idempotent and destroy drops late promise settlements", async () => {
    let resolveComplete!: (v: true) => void;

    const pending = new Promise<true>((resolve) => {
      resolveComplete = resolve;
    });

    // SAFETY: the stub Input and hooks below implement only what this test exercises;
    // the casts restore the zero types those partial stand-ins replace.
    const view = new ObservableView(
      {
        getSchema: () => ({}) as never,
        fetch: () => [] as never,
        setOutput: () => {},
        destroy: () => {},
      } as never,
      { singular: false, relationships: {} },
      () => {},
      () => {},
      pending,
      () => {},
    );

    let calls = 0;

    const unsub = view.subscribe(() => {
      calls++;
    });

    unsub();
    unsub();
    view.destroy();
    resolveComplete(true);
    await pending;
    await Promise.resolve();
    expect(calls).toBe(0);
    expect(view.getSnapshot().status).toBe("unknown");
  });
});
