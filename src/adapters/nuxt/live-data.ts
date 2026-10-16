import type { QueryStatus } from "../../core/types.ts";

/**
 * Whether live rows replace the SSR payload. `cached` counts: it is a usable
 * result that includes local writes, so the stale payload must not outlive it.
 */
export function liveDataWins(status: QueryStatus): boolean {
  return status === "cached" || status === "complete" || status === "error";
}
