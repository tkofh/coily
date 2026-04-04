---
"coily": minor
---

Add `timeRemaining` property to springs, exposing the analytically estimated time (in milliseconds) until the spring comes to rest.

- `spring.timeRemaining` available on the core `Spring` instance
- `useSpring()` returns a reactive `timeRemaining` ref for Vue apps
- `SpringConfig.computeTimeRemaining(state)` is available for standalone estimation
