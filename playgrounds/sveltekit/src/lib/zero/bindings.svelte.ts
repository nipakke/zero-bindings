import { createDefinitions } from "zero-bindings";
import { SvelteBindings } from "zero-bindings/svelte";
import { mutators } from "./mutators.ts";
import { queries } from "./queries.ts";
import { schema } from "./schema.ts";
import { getWorkspace } from "./workspace.svelte.ts";

export const zero = SvelteBindings.create({
  definitions: createDefinitions({ schema, queries, mutators }),
  client: () => getWorkspace().client,
});
