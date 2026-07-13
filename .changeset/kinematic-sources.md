---
'coily': minor
---

`velocityOf` and `accelerationOf` derive a source from another's motion —
its velocity (the rate its value changes, in value units per second) and
its acceleration (the rate its velocity changes, per second squared) — so
motion-driven effects use the same follow and `mapSpring` machinery as
everything else. A spring can chase another's velocity
(`blur.target = velocityOf(motion)`), and a map can shape either into
squash and stretch, trailing, or an impact flash
(`mapSpring(accelerationOf(motion), (a) => Math.min(1, Math.abs(a) * 1e-4))`).

A scalar source yields a scalar derivative a spring can follow; a
`CompositeSpring` or shape yields a derivative of the same shape, mapped
to a scalar the way the composite itself is. Each result is a stateless
view like a `mapSpring`: it holds no subscriptions, needs no disposal,
and is released with its source.

`Spring` and `CompositeSpring` gain a read-only `acceleration` (value
units per second squared) alongside `velocity`; it is exact, following
from the spring's stiffness and friction acting on its current
displacement and velocity.

Only a source in motion qualifies — a `Spring`, a `CompositeSpring`, or a
source bridging a value whose motion it tracks. A value derived with
`mapSpring` is not in motion, so both derivations reject it, in the types
and at runtime.
