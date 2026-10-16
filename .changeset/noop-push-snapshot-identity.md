---
"zero-bindings": patch
---

Fix query snapshots being republished with identical data when a change touched only a relationship outside the query result, such as the one `whereExists` creates.
