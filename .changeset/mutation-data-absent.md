---
"zero-bindings": patch
---

Mutation `data` is now an absent key, not `undefined`, on success legs and `onSuccess`/`onSettled` info when the mutator returned nothing.
