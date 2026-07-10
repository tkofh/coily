---
"coily": minor
---

`useSpring` and `useSpring2D` no longer take arrays of targets. An array
passed to `useSpring` now creates one spring object over the array shape —
`useSpring([0, 0])` is a single two-channel spring (tuple-typed, so the
arity is checked) — matching every other wrapping of the same value. For
several independent scalar springs, map over the targets instead;
composables are loop-safe:

```ts
const springs = targets.map((t) => useSpring(t))
```
