---
"zero-bindings": patch
---

Support Zero 1.11's `holdData()` view hook so queries materialized before the client is ready no longer report `cached` or `error` before their rows are applied.
