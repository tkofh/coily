---
"coily": minor
---

**BREAKING:** `SpringValue` component now takes a single `config` prop instead of individual `mass`/`tension`/`damping`/`precision` props. Accepts `SpringOptions` or a `SpringConfig` from `defineSpring()`.

- `jumpTo` is now available in the slot scope
- Component exposes `value`, `velocity`, `isResting`, `timeRemaining`, and `jumpTo` via template ref
