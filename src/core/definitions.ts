import type { BaseDefaultContext, Schema } from "@rocicorp/zero";
import type { QueryError } from "./types.ts";

/** The registry type a getter callback receives: `never` when no registry is bound. */
type BoundRegistry<TRegistry> = [TRegistry] extends [undefined] ? never : TRegistry;

/** A registry entry name: a bound registry keys it, an absent one allows any string. */
type EntryName<TRegistry> = [TRegistry] extends [undefined] ? string : keyof TRegistry & string;

/** A registry tuple: the entry name followed by its arguments. */
type EntryTuple<TRegistry> = readonly [EntryName<TRegistry>, ...unknown[]];

/** A registry getter: a direct callable, a registry callable, an entry name, or a name/argument tuple. */
export type Getter<TRegistry, TValue> =
  | (() => TValue)
  | ((registry: BoundRegistry<TRegistry>) => TValue)
  | EntryName<TRegistry>
  | EntryTuple<TRegistry>;

export type QueryGetter<TQueries, TQuery> = Getter<TQueries, TQuery>;

export type MutatorGetter<TMutators, TMutator> = Getter<TMutators, TMutator>;

/** A registry entry: a callable (given the tuple's extra arguments) or a stored value. */
type RegistryEntry<TValue> = TValue | ((...args: readonly unknown[]) => TValue);

/**
 * Resolves a getter against an optional registry. Direct signals are called
 * with no arguments; functions declaring parameters receive the registry;
 * names and tuples look up registry entries (tuples spread extra elements as
 * entry arguments). Anything unresolvable throws an `InvalidQuery` /
 * `InvalidMutator` {@link QueryError}; callers turn that into a snapshot.
 */
export function resolveGetter<TRegistry, TValue>(
  getter: Getter<TRegistry, TValue>,
  registry: TRegistry | undefined,
  kind: "Query" | "Mutator",
): TValue {
  const invalid = (message: string): QueryError => ({ type: `Invalid${kind}`, message });
  const registryName = kind.toLowerCase();

  /* oxlint-disable anti-slop/no-runtime-typeof -- the getter arms (callable vs name vs tuple, callable vs value) are runtime representations the static type does not distinguish. */
  if (typeof getter === "function") {
    if (registry === undefined) {
      if (getter.length > 0) {
        throw invalid(
          `${kind} getter requires arguments but no ${registryName} registry is bound.`,
        );
      }

      // SAFETY: the zero-argument branch of the callable getter arm.
      return (getter as () => TValue)();
    }

    if (getter.length === 0) {
      // SAFETY: the zero-argument branch of the callable getter arm.
      return (getter as () => TValue)();
    }

    // SAFETY: a callable with declared parameters takes the bound registry.
    return (getter as (registry: TRegistry) => TValue)(registry);
  }

  if (registry === undefined) {
    throw invalid(`${kind} name requires a ${registryName} registry.`);
  }

  const name = typeof getter === "string" ? getter : getter[0];
  const args = typeof getter === "string" ? [] : getter.slice(1);
  // SAFETY: a registry is an open string-keyed table of query/mutator entries; the entry read
  // by the resolved name is either callable (with the tuple's extra arguments) or a stored value.
  const entry = (registry as Readonly<Record<string, RegistryEntry<TValue>>>)[name];

  if (typeof entry === "function") {
    // SAFETY: the callable arm of `RegistryEntry`; the tuple's extra elements are its arguments.
    return (entry as (...args: readonly unknown[]) => TValue)(...args);
  }
  /* oxlint-enable anti-slop/no-runtime-typeof */

  if (entry === undefined) {
    throw invalid(`Unknown ${registryName} "${name}".`);
  }

  if (args.length > 0) {
    throw invalid(`${kind} "${name}" does not accept arguments.`);
  }

  return entry;
}

export type Definitions<
  TSchema extends Schema,
  TContext extends BaseDefaultContext = BaseDefaultContext,
  TQueries = undefined,
  TMutators = undefined,
> = Readonly<{
  readonly schema: TSchema;
  readonly context: TContext;
  readonly queries: TQueries;
  readonly mutators: TMutators;
}>;

export type DefinitionsOptions<
  TSchema extends Schema,
  TContext extends BaseDefaultContext = BaseDefaultContext,
  TQueries = undefined,
  TMutators = undefined,
> = {
  readonly schema: TSchema;
  readonly context?: TContext;
  readonly queries?: TQueries;
  readonly mutators?: TMutators;
};

export function createDefinitions<
  TSchema extends Schema,
  TContext extends BaseDefaultContext = BaseDefaultContext,
  TQueries = undefined,
  TMutators = undefined,
>(
  options: DefinitionsOptions<TSchema, TContext, TQueries, TMutators>,
): Definitions<TSchema, TContext, TQueries, TMutators> {
  // Definitions are immutable: freeze nested registries in place, then the container.
  if (options.queries !== undefined) {
    Object.freeze(options.queries);
  }

  if (options.mutators !== undefined) {
    Object.freeze(options.mutators);
  }

  // SAFETY: each optional option reaches a required definition slot; the omitted case is captured
  // exactly by its type parameter's `undefined` default, so the asserted value is the stored one.
  return Object.freeze({
    schema: options.schema,
    context: options.context as TContext,
    queries: options.queries as TQueries,
    mutators: options.mutators as TMutators,
  });
}
