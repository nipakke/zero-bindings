import { createDefinitions } from "zero-bindings";
import { VueBindings } from "zero-bindings/vue";
import { mutators } from "./mutators.ts";
import { queries } from "./queries.ts";
import { schema } from "./schema.ts";
import { activeClient } from "./workspace.ts";

export const zero = VueBindings.create({
  definitions: createDefinitions({ schema, queries, mutators }),
  client: () => activeClient.value,
});
