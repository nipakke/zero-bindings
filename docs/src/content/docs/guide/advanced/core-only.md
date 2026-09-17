---
title: Core-only and other frameworks
---

The core is the whole contract: sources in, session, resources out. Any host can consume it, and an adapter only adds source conversion plus host lifecycle bridging.

## Vanilla

```ts
import { createDefinitions, ZeroSession } from "zero-bindings";

const session = ZeroSession.create(createDefinitions({ schema, queries, mutators }), {
  client, // Zero<...> | undefined | Source<Zero<...> | undefined>
});

const issues = session.createQuery((queries) => queries.issue.all(), { ttl: "5m" });

function render(): void {
  const snapshot = issues.getSnapshot();
  root.textContent =
    snapshot.status === "complete" ? `${snapshot.data?.length ?? 0} issues` : snapshot.status;
}

const stop = issues.subscribe(render);
issues.start(); // subscribe → materialize; then render the current snapshot
render();

// Teardown
stop();
issues.dispose();
session.dispose();
```

Three rules cover every core consumer:

1. **Subscribe, then start.** `subscribe()` never starts a resource; a resource only materializes after an explicit `start()`.
2. **Pull the snapshot.** `getSnapshot()` is cached: consecutive reads without a state change are referentially equal, so it is safe to hand the object to a rendering layer that compares by identity.
3. **Dispose what you own.** `stop()` releases the view and input subscriptions but keeps the last snapshot; `dispose()` is terminal and idempotent. `session.dispose()` disposes the resources it created and never closes an externally owned client.

## Compatibility with Zero

```json
{
  "peerDependencies": {
    "@rocicorp/zero": ">=1.7.0 <1.10.0"
  }
}
```

Pin one Zero version per application. The Zero contract this package depends on — the view-factory signature, `Output.push`, `applyChange`/`skipYields`, `DEFAULT_TTL_MS`, and the local-only mutation-leg behavior — is recorded in the repository's `.agents/zero-contract.md` alongside the pinned version.

Next: [Make an adapter](/development/make-an-adapter).
