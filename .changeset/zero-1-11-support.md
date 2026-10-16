---
"zero-bindings": minor
---

Add Zero 1.11 to the supported test matrix and widen the `@rocicorp/zero` peer range to `>=1.7.0 <1.12.0`.

Map Zero 1.11's `cached` result type. `QueryStatus` widens to `"complete" | "cached" | "unknown" | "error" | "disabled"`.

**Possible breaking change:** consumers with exhaustive switches (or narrowed types) on `status` must handle `"cached"`. Migration: treat `"cached"` like `"unknown"`. Older Zero versions never report it.
