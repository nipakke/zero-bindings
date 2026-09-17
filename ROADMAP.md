# ROADMAP.md

Open work only. Everything settled lives in `AGENTS.md` and `.agents/*.md`.

One gate holds both items: a refetch policy needs a sink, and the only candidate sink is the answer to the ownership question below.

| # | Item | State |
|---|------|-------|
| 1 | Run ownership / app-level mutation reporting | Gated — one question for the user |
| 2 | The refetch policy | Not started; waits on 1 |

## 1. Run ownership / app-level mutation reporting

`MutationController` fuses the run (state + its callbacks) with the view, so callback delivery dies with the resource — the two holes are pinned behavior in `tests/core/mutation.test.ts`, not bugs to patch.

**The one question: do you want mutation reporting for calls no call site opted into?**

- **Yes** → session-owned in-flight run set plus a `ZeroSession.onDispose` for eviction, and the bindings stop being inert.
- **No** → resource-owned runs stay as they are; promises and `subscribe()` are the documented answer.

Either way: never a retained cache — `gcTime`, `find`/`findAll`, and `mutationKey` dedupe stay deferred per `.agents/core-rationale.md`.

## 2. The refetch policy

"Refetch X when Y succeeds" is a policy, not a callback — string-keyed, typo-silent, re-derived per app once any sink exists. Separate design; blocked on item 1.
