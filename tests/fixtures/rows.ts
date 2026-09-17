/**
 * A snapshot's data as a host publishes it: JSON, since that is what a JSON
 * round trip leaves behind. Recursive for nested rows and loaded children.
 */
export type RowSnapshot =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly RowSnapshot[]
  | { readonly [key: string]: RowSnapshot };

/**
 * Snapshot data as a consumer of it sees it: a JSON round trip drops Zero's
 * `Symbol(rc)` row markers, and any `undefined` (an absent singular row, an
 * unloaded child) survives as `undefined`.
 */
export function rows(value: RowSnapshot): RowSnapshot {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
