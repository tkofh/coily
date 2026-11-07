---
'coily': minor
---

Add ramps: `system.createRamp(from, { rate, target })` makes a value that
moves toward its target at a fixed speed, in a straight line, and stops
there. `Infinity` or `-Infinity` makes it endless. A ramp is a source, so a
spring can follow it, and the spring tracks its steady motion exactly
instead of chasing a target written once per frame, which lands about half
a frame behind. Use one for an endless spin, a heading that turns at a capped
speed, or a clock in milliseconds mapped into a shape with `mapSpring`.

```ts
const sweep = system.createRamp(0, { rate: 270, target: Infinity })
const ring = system.createSpring(sweep)
```

A ramp has the spring surface where it applies: writable `value`,
`target`, and `rate`, plus `velocity`, `isResting`, `timeRemaining`,
`settled`, `jumpTo`, `dispose`, and the usual events. `velocityOf`,
`accelerationOf`, and `targetOf` accept it. A ramp runs in the frame loop
only while something listens to it frame by frame. Otherwise it keeps
moving on the system's clock without costing a frame, and a read reports
where it is. The clock holds still through synchronous code, so reads in
one render or event handler agree.

Under reduced motion a ramp jumps to a bounded target, and an endless ramp
holds still until reduced motion turns off. `purpose: 'nonmotion'` keeps a
ramp moving regardless, for a clock that drives logic.

`useRamp(target, rate, { from, purpose })` in `coily/vue` returns a
`RampRef`, which `useSpring` can follow. It keeps the ramp in the frame loop
only while something reads it. The Nuxt module auto-imports `useRamp`.
