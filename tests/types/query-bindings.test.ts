import { describe, test } from "vite-plus/test";
import { defineQueriesWithType, defineQueryWithType, type Zero } from "@rocicorp/zero";
import { VueBindings } from "../../src/adapters/vue/index.ts";
import { createDefinitions } from "../../src/core/definitions.ts";
import { itemSchema as schema, itemZql as zql } from "../fixtures/item.ts";

type Product = { readonly id: number; readonly name: string };

// This mirrors generated domain definitions: defineQueries may nest query
// groups, and each leaf is a schema-bound defineQuery request.
const defineGeneratedQuery = defineQueryWithType<typeof schema>();

const queryDefinitions = {
  catalog: {
    products: {
      list: defineGeneratedQuery(({ args }: { args: { id?: number } | undefined }) =>
        zql.item.where("id", args?.id ?? 1),
      ),
      byId: defineGeneratedQuery(({ args }: { args: { id: number } }) =>
        zql.item.where("id", args.id).one(),
      ),
    },
  },
};

const queries = defineQueriesWithType<typeof schema>()(queryDefinitions);

// SAFETY: the client is intentionally absent — the assertions below are
// type-level only, and `useQuery` is never invoked at runtime.
const bindings = VueBindings.create({
  definitions: createDefinitions({ schema, queries }),
  client: undefined as Zero<typeof schema> | undefined,
});

describe("query binding types", () => {
  test("preserves generated nested query result types for both getter forms", () => {
    // Type-level assertions: `useQuery` throws outside a component scope, so
    // the closure is never invoked — TypeScript still checks both getter forms.
    const checkTypes = (): void => {
      const fromRegistry = bindings.useQuery((q) => q.catalog.products.list());
      const fromClosure = bindings.useQuery(() => queries.catalog.products.byId({ id: 1 }));

      const products: Product[] = fromRegistry.data.value ?? [];
      const product: Product | undefined = fromClosure.data.value;
      void products;
      void product;
    };

    void checkTypes;
  });

  test("query data is typed as possibly undefined", () => {
    // Type-level assertion: no client, a disabled resource, and an empty
    // singular query all yield `undefined`, so the data must stay non-nullable.
    const checkTypes = (): void => {
      const result = bindings.useQuery(() => zql.item);
      // @ts-expect-error data is possibly undefined: no client, disabled, and empty singular queries all yield undefined
      const strict: NonNullable<typeof result.data.value> = result.data.value;
      void strict;
    };

    void checkTypes;
  });
});
