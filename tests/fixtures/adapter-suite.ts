import { expect } from "vite-plus/test";
import type { Zero } from "@rocicorp/zero";
import { MutationError } from "../../src/core/mutation.ts";
import { itemSchema } from "./item.ts";
import type { RowSnapshot } from "./rows.ts";
import { createTestZero } from "./zero.ts";

/**
 * The expectations the Vue and Svelte adapter specs share, written once over a
 * small adapter-neutral view. Each framework test builds that view from its own
 * mirror in a few glue lines: a read is `.value` on Vue refs, a plain field on
 * Svelte runes, and the flush is `nextTick`/`tick`.
 */

/** A query mirror as the lifecycle specs read it. */
export interface QueryView {
  /** Current snapshot status. */
  status(): string;
  /** Current snapshot data, `rows()`-normalized. */
  data(): RowSnapshot;
  /** Points the adapter's client source at `client`. */
  setClient(client: Zero<typeof itemSchema> | undefined): void;
  /** Awaits the framework's flush: Vue `nextTick`, Svelte `tick`. */
  flush(): Promise<void>;
}

/** The client-replacement sequence every adapter must reproduce. */
export async function expectClientReplacement(view: QueryView): Promise<void> {
  await view.flush();
  expect(view.status()).toBe("unknown");

  const first = createTestZero({ schema: itemSchema, userID: "first" });
  await first.mutate.item.insert({ id: 1, name: "first" });
  view.setClient(first);
  await view.flush();
  expect(view.data()).toEqual([{ id: 1, name: "first" }]);

  const second = createTestZero({ schema: itemSchema, userID: "second" });
  await second.mutate.item.insert({ id: 2, name: "second" });
  view.setClient(second);
  await view.flush();
  expect(view.data()).toEqual([{ id: 2, name: "second" }]);

  view.setClient(undefined);
  await view.flush();
  expect(view.status()).toBe("unknown");
  expect(view.data()).toBeUndefined();
}

/** A mutation mirror as the lifecycle specs read it. */
export interface MutationMirrorView {
  isPending(): boolean;
  client(): { readonly status: string; readonly error: unknown };
  server(): { readonly status: string; readonly error: unknown };
  /** The mirror's surfaced error; the adapters pick the client leg's. */
  error(): Error | undefined;
  mutate(args: { id: number; name: string }): {
    readonly client: Promise<{ readonly type: string }>;
  };
  reset(): void;
}

/** The mutation-mirror lifecycle (`ok` succeeds, `failing` throws). */
export async function expectMutationMirrorLifecycle(
  ok: MutationMirrorView,
  failing: MutationMirrorView,
): Promise<void> {
  expect(ok.isPending()).toBe(false);
  expect(ok.client().status).toBe("idle");
  expect(ok.server().status).toBe("idle");
  expect(ok.error()).toBeUndefined();

  const inflight = ok.mutate({ id: 10, name: "mirror" });
  // mutate() lands the pending snapshot synchronously, on the same tick.
  expect(ok.isPending()).toBe(true);
  expect(ok.client().status).toBe("pending");
  // A local-only client has no connected server leg to track.
  expect(ok.server().status).toBe("unavailable");

  expect((await inflight.client).type).toBe("success");
  expect(ok.isPending()).toBe(false);
  expect(ok.client().status).toBe("success");
  expect(ok.error()).toBeUndefined();

  ok.reset();
  expect(ok.client().status).toBe("idle");
  expect(ok.server().status).toBe("idle");
  expect(ok.isPending()).toBe(false);

  expect((await failing.mutate({ id: 11, name: "x" }).client).type).toBe("error");
  expect(failing.client().status).toBe("error");
  // The `??` picks the client error; the server leg stays unerrred.
  expect(failing.error()).toBeInstanceOf(MutationError);
  expect(failing.error()?.message).toContain("mutator boom");
  expect(failing.server().status).toBe("unavailable");
  expect(failing.server().error).toBeUndefined();
  expect(failing.isPending()).toBe(false);

  failing.reset();
  expect(failing.error()).toBeUndefined();
  expect(failing.client().status).toBe("idle");
}

/** What a `useSession` identity spec observed inside and outside the host. */
export interface SessionIdentity {
  /** The session the host handed back outside the component. */
  installed: unknown;
  /** The session `useSession()` returned inside the component. */
  injected: unknown;
  /** Two `useSession()` calls in the host returned the same session. */
  same: boolean;
  /** That session's client is the client the bindings were built with. */
  clientMatches: boolean;
  /** A query resource the host started through that session is active. */
  active: boolean;
}

/** The `useSession` identity every adapter must satisfy. */
export function expectSessionIdentity(view: SessionIdentity): void {
  expect(view.same).toBe(true);
  expect(view.clientMatches).toBe(true);
  expect(view.active).toBe(true);
  expect(view.installed).toBe(view.injected);
}
