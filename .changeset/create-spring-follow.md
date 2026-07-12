---
'coily': minor
---

`createSpring` accepts a `SpringSource` in place of the value — on
`SpringSystem` and on `useSpringPool` pools — creating a spring that
starts at the source's current value and follows it from birth:
`system.createSpring(mapSpring(lead, ({ x, y }) => Math.hypot(x, y), null))`.
Equivalent to creating at `source.value` and assigning the source to
`target`; without a config of its own the new spring adopts the
source's.
