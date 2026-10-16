---
"zero-bindings": minor
---

Map Zero 1.11's `cached` result type. `QueryStatus` widens to `"complete" | "cached" | "unknown" | "error" | "disabled"`.

**Possible breaking change:** consumers with exhaustive switches (or narrowed types) on `status` must handle `"cached"`. Migration: treat `"cached"` like `"unknown"`.
