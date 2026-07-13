---
'coily': minor
---

`velocityOf` and `accelerationOf` make a source out of a spring's motion:
its velocity (how fast its value is changing, in value units per second)
or its acceleration (how fast that velocity is changing). You follow them
and map them like any other source, so an effect can ride a spring's
motion instead of its position:

```ts
// a blur that chases how fast something is moving
blur.target = velocityOf(motion)

// an impact flash from a sharp change in speed
flash.target = mapSpring(accelerationOf(motion), (a) => Math.min(1, Math.abs(a) * 1e-4))
```

Derive from a scalar and you get a scalar to follow; derive from a
composite and you get the same shape, ready to reduce with `mapSpring`.
There's nothing to clean up: each derived source lives and dies with the
spring behind it.

`Spring` and `CompositeSpring` also gain a read-only `acceleration` (value
units per second squared) next to `velocity`. It is exact, not estimated
frame to frame.

Only a `Spring` or a `CompositeSpring` is in motion, so only those can be
derived. A `mapSpring` result isn't, so `velocityOf` and `accelerationOf`
reject it, in the types and at runtime.
