---
"zero-bindings": patch
---

Nuxt: live query data now replaces the SSR payload as soon as the live resource reports `cached`, not only at `complete` or `error`.
