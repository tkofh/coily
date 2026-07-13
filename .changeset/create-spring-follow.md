---
'coily': minor
---

`createSpring` accepts a `SpringSource` in place of the value — on
`SpringSystem` and on `useSpringPool` pools — creating a spring that
starts at the source's current value and follows it from birth:
`system.createSpring(mapSpring(lead, ({ x, y }) => Math.hypot(x, y)))`.
Equivalent to creating at the source's current value and assigning the
source to `target`.
