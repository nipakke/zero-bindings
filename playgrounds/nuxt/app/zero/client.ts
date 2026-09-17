import { Zero } from "@rocicorp/zero";
import { mutators } from "./mutators.ts";
import { schema, type AppSchema } from "./schema.ts";

export type AppClient = Zero<AppSchema>;

/** A local-only client per demo identity; a cache URL enables payload SSR. */
export function createClient(cacheURL: string | null, userID: string): AppClient {
  return new Zero<AppSchema>({
    cacheURL,
    userID,
    schema,
    kvStore: "mem",
    mutators,
  });
}
