---
'coily': minor
---

Add `targetOf(spring)`, a source that reads where a spring is heading
instead of where it is. Pair it with the spring in a `mapSpring` shape to
express anything measured against the destination, such as remaining
travel, progress, or a lead that anticipates the move. You wire it once,
and you no longer rebuild the map on every retarget. A `CompositeSpring`
gives a target of the same shape. The Nuxt module auto-imports `targetOf`.

```ts
const lead = mapSpring({ value: body, target: targetOf(body) }, ({ value, target }) =>
  Math.max(-20, Math.min(20, target - value)),
)
const eyes = system.createSpring(lead)
```

Vue refs from `useSpring` now type-check with `velocityOf`, `accelerationOf`,
and `targetOf`. They always worked at runtime, as the springs they wrap do.
The new `TargetedSource` type names what `targetOf` accepts: a source in
motion that also reports its target. Every spring, composite, and spring
ref is one.
