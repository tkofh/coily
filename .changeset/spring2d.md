---
"coily": minor
---

Added `Spring2D` and `useSpring2D` for multi-dimensional spring animations. A `Spring2D` bundles two scalar springs behind a `Vector2`-aware API — no changes to the solver, each axis is independent.

```ts
// Core
const spring = system.createSpring2D({ x: 0, y: 0 })
spring.target = { x: 100, y: 200 }

// Vue
const pos = useSpring2D(mouse, { dampingRatio: 1, duration: 500 })
```

Springs can follow other springs via the `target` setter:

```ts
const a = system.createSpring2D({ x: 0, y: 0 })
const b = system.createSpring2D({ target: a })
```
