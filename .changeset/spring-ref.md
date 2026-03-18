---
"coily": minor
---

**BREAKING:** `useSpring()` now returns a `SpringRef` instead of an object with separate `value`/`velocity`/`isResting`/`timeRemaining` refs.

- `spring.value.value` → `spring.value` (the ref _is_ the value)
- `spring.velocity`, `spring.isResting`, `spring.timeRemaining` are still refs on the object
- `spring.jumpTo()` is now a method on the ref
- Auto-unwraps in templates: `<div :style="{ opacity: spring }" />`
