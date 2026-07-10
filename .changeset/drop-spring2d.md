---
"coily": minor
---

Remove the 2D API: `createSpring2D`, `Spring2D`, `useSpring2D`,
`SpringRef2D`, the pool's `createSpring2D`, and the `Vector2` type. Spring
objects are a strict superset — a 2D spring is a spring object over
`{ x, y }`:

```ts
system.createSpring2D({ x: 0, y: 0 })     // before
system.createSpringObject({ x: 0, y: 0 }) // after — same API, plus partial writes

useSpring2D(target) // before
useSpring(target)   // after
```

Displaced creation composes from create + retarget, with identical
semantics including under reduced motion:

```ts
system.createSpring2D({ target, value }) // before

const spring = system.createSpringObject(value) // after
spring.target = target
```

Following works the same in the object form — `spring.target = leader`, or
`{ spring: leader, offset: { x: 20 } }` (offsets are partial shapes). Two
observable differences: the `tension`/`damping` convenience getters are
gone (read them off `spring.config`), and `config` reads
`SpringConfig | null`, since channels can diverge under per-channel
configs.
