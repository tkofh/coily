# coily

Simulate values using spring physics.

Coily animates numbers (and 2D vectors) with damped spring motion. Each frame is computed from the closed-form solution of the spring equation — underdamped, critically damped, or overdamped — rather than numerical integration, so motion doesn't accumulate error and springs can be retargeted mid-flight without losing momentum.

The core has zero dependencies and runs anywhere (it falls back from `requestAnimationFrame` to `setTimeout` outside the browser). Vue and Nuxt integrations ship as separate entry points; `vue` and `@nuxt/kit` are optional peer dependencies.

## Install

```sh
pnpm add coily
```

## Quick start

```ts
import { createSpringSystem, defineSpring } from 'coily'

const system = createSpringSystem()
system.start()

const spring = system.createSpring(0, defineSpring({ tension: 500, damping: 40 }))

spring.onUpdate(() => {
  ball.style.setProperty('--x', String(spring.value))
})

// Animate toward a new target at any time. Position and velocity
// carry over, so interruptions look natural.
spring.target = 300
```

## Configuring springs

`defineSpring` accepts several input shapes; whatever you leave out is derived:

```ts
defineSpring({ tension: 500, damping: 40 })      // direct physical parameters
defineSpring({ tension: 500, dampingRatio: 0.7 }) // damping derived
defineSpring({ tension: 500, bounce: 0.3 })       // bounce = 1 - dampingRatio
defineSpring({ duration: 750, dampingRatio: 1 })  // tuned to settle in ~750ms
defineSpring({ duration: 750, bounce: 0.5 })
```

- **`tension`** — stiffness (> 0)
- **`damping`** — friction (≥ 0)
- **`dampingRatio`** — 0 = undamped, < 1 = bouncy, 1 = critically damped, > 1 = overdamped
- **`bounce`** — friendlier alias for damping ratio: −1 (overdamped) to 1 (max bounce)
- **`duration`** — target settle time in ms. Assumes an initial displacement of 1; pass `displacement` matching your animation range for accurate timing
- **`mass`** — defaults to 1
- **`precision`** — decimal places for reported values (default 2). A spring is *resting* once position and velocity both round to zero

Without a config, springs are critically damped with a ~500ms settle time.

## Spring API

- `spring.target` — set to animate toward a new value
- `spring.value` — current value; writable to displace the spring
- `spring.velocity` — current velocity; writable to fling
- `spring.jumpTo(v)` — snap to a value with no animation
- `spring.config` — assign a new `SpringConfig`, or `null` to revert to the default (or the leader's, if following)
- `spring.isResting`, `spring.timeRemaining` — settle state and estimated ms until rest
- `spring.onUpdate(cb)` / `onStart(cb)` / `onStop(cb)` — subscribe; each returns an unsubscribe function. `start` fires when the spring leaves rest, `stop` when it settles — the two always alternate, and retargeting mid-flight fires neither
- `spring.dispose()` — release the spring

### Chaining

A spring can follow another spring's live value instead of a fixed number:

```ts
const leader = system.createSpring(0)
const follower = system.createSpring({ target: leader })
const trailing = system.createSpring({ target: { spring: leader, offset: 20 } })
```

Followers inherit the leader's config unless given their own. Assigning a number to `target` unfollows.

### 2D

`system.createSpring2D({ x: 0, y: 0 })` runs one spring per axis behind a single `Spring`-like API that takes and returns `{ x, y }` vectors — including chaining onto other 2D springs.

## Vue

Provide a spring system once, near the root of your app:

```ts
import { useSpringSystem } from 'coily/vue'

// in setup(): creates a system, provides it, starts it on mount
useSpringSystem()
```

(Or `provideSpringSystem(system, app)` to install an existing system app-wide.)

Then animate anywhere below:

```vue
<script setup>
import { useSpring } from 'coily/vue'

const target = ref(0)
const x = useSpring(target, { duration: 500, bounce: 0.3 })
</script>

<template>
  <div class="ball" :style="{ translate: `${x}px 0` }" @click="target = 300" />
</template>
```

`useSpring` returns a `SpringRef`: a writable ref of the animated value with `velocity`, `isResting`, and `timeRemaining` refs plus `jumpTo()` attached. The target can be a ref, a getter, or another `SpringRef` (which chains the springs). Options are also reactive — swap configs and the spring reconfigures in place. `useSpring2D` is the same for `{ x, y }` values.

There's also a renderless `<SpringValue :target="n">` component exposing `{ value, velocity, isResting, timeRemaining, jumpTo }` through its default slot.

## Nuxt

```ts
export default defineNuxtConfig({
  modules: ['coily/nuxt'],
  coily: { debug: false }, // debug logs active motion counts
})
```

The module provides a spring system for the whole app (started on the client), auto-imports `useSpring`, `useSpring2D`, and `defineSpring`, and registers the `SpringValue` component.

## Timing

The built-in ticker targets 60fps by default (`fps` option/property) and clamps large frame gaps — e.g. returning from a backgrounded tab — via `lagThreshold` (default 500ms) and `adjustedLag` (default 33ms), so springs don't teleport. For manual stepping, skip `system.start()` and call `system.advance(dtMs)` yourself.

## License

MIT
