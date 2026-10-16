---
"zero-bindings": minor
---

**BREAKING:** drop support for `@rocicorp/zero` < 1.11. The peer range is now `>=1.11.0 <1.12.0` and the test matrix runs only Zero 1.11. Adds Zero 1.11 support, including its `holdData()` view hook: queries materialized before the client is ready no longer report `cached` or `error` before their rows are applied.
