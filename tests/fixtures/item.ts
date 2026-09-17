import {
  createBuilder,
  createSchema,
  defineMutatorWithType,
  defineMutatorsWithType,
  number,
  string,
  table,
  type EnsureMutatorDefinitions,
  type MutatorRegistry,
  type SchemaQuery,
  type Transaction,
} from "@rocicorp/zero";

const itemTable = table("item").columns({ id: number(), name: string() }).primaryKey("id");

/** Named shape of {@link itemSchema}: Zero's inferred schema type is not nameable on its own. */
type ItemSchema = ReturnType<typeof createSchema<[typeof itemTable], [], undefined, true>>;

/** The `item` table the core tests insert, update, and read rows through. */
export const itemSchema: ItemSchema = createSchema({
  tables: [itemTable],
  enableLegacyMutators: true,
});

/** Query builder over {@link itemSchema}. */
export const itemZql: SchemaQuery<ItemSchema> = createBuilder(itemSchema);

/** The mutator callbacks' parameter shape, bound to {@link itemSchema}. */
type ItemArgs<TArgs> = { tx: Transaction<ItemSchema, unknown>; args: TArgs; ctx: unknown };

type ItemMutator = ReturnType<typeof defineMutatorWithType<ItemSchema, unknown, unknown>>;

/** A typed mutator factory bound to {@link itemSchema}. */
const itemMutator: ItemMutator = defineMutatorWithType<ItemSchema, unknown, unknown>();

const itemMutatorDefinitions = {
  item: {
    create: itemMutator(async ({ tx, args }: ItemArgs<{ id: number; name: string }>) => {
      await tx.mutate.item.insert({ id: args.id, name: args.name });
    }),
    fail: itemMutator(async ({ args }: ItemArgs<{ id: number }>) => {
      throw new Error(`mutator boom ${args.id}`);
    }),
    boom: itemMutator(async ({ args }: ItemArgs<{ id: number; name: string }>) => {
      throw new Error(`mutator boom ${args.name}`);
    }),
  },
};

/**
 * The registry every test client registers: a real insert plus the two
 * failures the callback/error tests assert on (`fail` reports the id, `boom`
 * the name).
 */
export const itemMutators: MutatorRegistry<
  EnsureMutatorDefinitions<typeof itemMutatorDefinitions>,
  ItemSchema
> = defineMutatorsWithType<ItemSchema>()(itemMutatorDefinitions);
