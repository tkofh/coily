---
'coily': minor
---

Add `targetOf(spring)`: a source that reads a spring's target, where it is
heading rather than where it is. Paired with the spring in a `mapSpring`
shape, it expresses anything measured against the destination, such as
remaining travel, progress, or a lead that anticipates the move, as one
static wiring instead of a map rebuilt on every retarget. A `CompositeSpring`
yields a target of the same shape. The Nuxt module auto-imports it.

```ts
const lead = mapSpring({ value: body, target: targetOf(body) }, ({ value, target }) =>
  Math.max(-20, Math.min(20, target - value)),
)
const eyes = system.createSpring(lead)
```

Vue refs from `useSpring` now type-check with `velocityOf`, `accelerationOf`,
and `targetOf`, as the springs they wrap always did at runtime. The new
`TargetedSource` type names what `targetOf` accepts: a source in motion that
also reports its target, which every spring, composite, and spring ref is.
