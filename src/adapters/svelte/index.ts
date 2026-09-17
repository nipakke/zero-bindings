export { SvelteBindings, type SvelteBindingsOptions } from "./create-bindings.ts";

export { default as ZeroProvider } from "./ZeroProvider.svelte";

export {
  bindMutationResource,
  bindQueryResource,
  type MaybeQueryResult,
  type UseMutationResult,
  type UseQueryError,
  type UseQueryOptions,
} from "./mirror.svelte.ts";

export {
  MutationError,
  MutationTimeoutError,
  type MutationCallbacks,
  type MutationInfo,
  type MutationKind,
  type MutationOptions,
} from "../../core/mutation.ts";

export type { QueryError, QueryStatus } from "../../core/types.ts";
