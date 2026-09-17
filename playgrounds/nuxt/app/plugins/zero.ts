import { nextTick, ref, shallowRef } from "vue";
import { createDefinitions } from "zero-bindings";
import { NuxtBindings } from "zero-bindings/experimental_nuxt";
import { createClient, type AppClient } from "../zero/client.ts";
import { DEMO_USERS, seedTodos } from "../zero/demo-data.ts";
import { mutators } from "../zero/mutators.ts";
import { queries } from "../zero/queries.ts";
import { schema } from "../zero/schema.ts";

async function retire(client: AppClient, seed: Promise<void>): Promise<void> {
  await nextTick();

  try {
    await seed;
  } finally {
    await client.close();
  }
}

/**
 * Installs one reactive client source for this Nuxt app. Server renders keep a
 * cache-backed client for the experimental payload path; browser-only local
 * clients are seeded and replaced when the demo identity changes.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const { zeroCacheURL } = useRuntimeConfig().public;
  const cacheURL = zeroCacheURL === "" ? null : zeroCacheURL;
  const zeroUserID = ref<string>(DEMO_USERS[0].id);
  const activeClient = shallowRef<AppClient>(createClient(cacheURL, zeroUserID.value));
  let activeSeed: Promise<void> = Promise.resolve();

  if (import.meta.client && cacheURL === null) {
    activeSeed = seedTodos(activeClient.value, zeroUserID.value);
  }

  const switchZeroUser = (userID: string): void => {
    if (!import.meta.client || userID === zeroUserID.value) {
      return;
    }

    const outgoing = activeClient.value;
    const outgoingSeed = activeSeed;
    const next = createClient(cacheURL, userID);
    const nextSeed = cacheURL === null ? seedTodos(next, userID) : Promise.resolve();

    activeClient.value = next;
    zeroUserID.value = userID;
    activeSeed = nextSeed;
    void retire(outgoing, outgoingSeed);
  };

  const bindings = NuxtBindings.create({
    definitions: createDefinitions({ schema, queries, mutators }),
    client: activeClient,
  });

  nuxtApp.vueApp.use(bindings);

  return {
    provide: {
      zero: bindings,
      /** Whether the server render has a cache to fetch rows from. */
      zeroServerData: cacheURL !== null,
      zeroUsers: DEMO_USERS,
      zeroUserID,
      switchZeroUser,
    },
  };
});
