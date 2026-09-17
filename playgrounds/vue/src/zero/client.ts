import { Zero } from "@rocicorp/zero";
import { mutators } from "./mutators.ts";
import { schema, type AppSchema } from "./schema.ts";

export type AppClient = Zero<AppSchema>;

export function createClient(userID: string): AppClient {
  return new Zero<AppSchema>({
    cacheURL: null,
    userID,
    schema,
    kvStore: "mem",
    mutators,
  });
}
