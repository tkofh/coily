# coily

Simulate values using spring physics.

Coily animates numbers and whole numeric shapes with damped spring motion. It computes each frame from the closed-form solution of the spring equation (underdamped, critically damped, or overdamped) rather than numerical integration, so motion doesn't accumulate error and you can retarget a spring mid-flight without losing momentum.

The core has zero dependencies and runs anywhere (it falls back from `requestAnimationFrame` to `setTimeout` outside the browser). Vue and Nuxt integrations ship as separate entry points, with `vue` and `@nuxt/kit` as optional peer dependencies.

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

`defineSpring` accepts several input shapes and derives whatever you leave out:

```ts
defineSpring({ tension: 500, damping: 40 }) // direct physical parameters
defineSpring({ tension: 500, dampingRatio: 0.7 }) // damping derived
defineSpring({ tension: 500, bounce: 0.3 }) // bounce = 1 - dampingRatio
defineSpring({ duration: 750, dampingRatio: 1 }) // tuned to settle in ~750ms
defineSpring({ duration: 750, bounce: 0.5 })
```

- **`tension`**: stiffness (> 0)
- **`damping`**: friction (>= 0)
- **`dampingRatio`**: 0 = undamped, < 1 = bouncy, 1 = critically damped, > 1 = overdamped
- **`bounce`**: a friendlier alias for damping ratio, from -1 (overdamped) to 1 (max bounce)
- **`duration`**: target settle time in ms. Assumes an initial displacement of 1. Pass `displacement` matching your animation range for accurate timing
- **`mass`**: defaults to 1
- **`precision`**: decimal places of the resting threshold (default 2). A spring is _resting_ once its remaining motion cannot reach half a unit in the last place (0.005 at the default). Coily never rounds values. Set `precision` to match your domain's resolution (see [PRECISION.md](https://github.com/tkofh/coily/blob/main/PRECISION.md))

Without a config, springs are critically damped with a ~500ms settle time.

## Spring API

- `spring.target`: set to animate toward a new value
- `spring.value`: current value, writable to displace the spring
- `spring.velocity`: current velocity, writable to fling
- `spring.jumpTo(v)`: snap to a value with no animation
- `spring.config`: assign a new `SpringDefinition`, or `null` to revert to the default
- `spring.isResting`, `spring.timeRemaining`: settle state and estimated ms until rest
- `spring.settled`: a promise that resolves when the spring next comes to rest (immediately if already resting). Retargeting mid-flight extends the wait; disposing resolves it. `await spring.settled` to sequence animations
- `spring.onUpdate(cb)` / `onStart(cb)` / `onStop(cb)` / `onDispose(cb)`: subscribe. Each returns an unsubscribe function. `start` fires when the spring leaves rest, `stop` when it settles. The two always alternate, and retargeting mid-flight fires neither
- `spring.dispose()`: release the spring (calling it twice is a no-op)

### Chaining

A spring can follow another spring's live value instead of a fixed number: assign a spring to `target`, or pass one straight to `createSpring` to follow from birth. `mapSpring` derives new followable values from existing ones (offsets, mirrors, clamps, any pure function of the value):

```ts
const leader = system.createSpring(0)

const follower = system.createSpring(leader)
const trailing = system.createSpring(mapSpring(leader, (v) => v + 20))
const mirrored = system.createSpring(mapSpring(leader, (v) => -v))
```

A follower's config is its own: following changes what a spring chases, never how it moves. To match a leader's feel, pass its config at creation — `system.createSpring(leader, leader.config)` — or share a `defineSpring` constant. Assigning a number to `target` unfollows.

`mapSpring` also combines several springs: pass a shape (a plain object or array with springs at the leaves, nested arbitrarily) and a function of their values:

```ts
const x = system.createSpring(0)
const y = system.createSpring(0)

const distance = system.createSpring(mapSpring({ x, y }, ({ x, y }) => Math.hypot(x, y)))
```

Composite springs (below) are sources of their whole value shape, so one map can derive a scalar from every channel at once:

```ts
const point = system.createSpring({ x: 3, y: 4 })

const magnitude = system.createSpring(mapSpring(point, ({ x, y }) => Math.hypot(x, y)))
```

A mapped value is a `SpringSource`, the contract `target` accepts and every `Spring` implements. A `CompositeSpring` is a source _of its shape_: `mapSpring` reads it, alone or at the leaves of a shape, but only scalar sources can be followed directly.

Follow graphs may contain cycles: retargets never re-emit, so nothing loops within a frame. Mutual followers converge to a shared value. A cycle whose maps expand (`(v) => v + 10` in both directions) chases forever and never rests, keeping the system awake until you break the cycle.

### Composites

`createSpring` also takes any numeric shape: a plain object or array whose leaves are all numbers, nested arbitrarily. Each leaf becomes an independent channel behind one composite API, a `CompositeSpring`:

```ts
const spring = system.createSpring({ position: { x: 0, y: 0 }, opacity: 1 })

spring.target = { position: { x: 100 } } // a partial target leaves other channels alone
spring.value // { position: { x, y }, opacity } — a stable, read-only mirror
```

The shape is fixed at creation, and unknown channels throw with their path (`position.z`). `value`, `velocity`, and `jumpTo` take the same partial shapes. Composites coalesce their events: `update` fires at most once per frame with every channel in its final per-frame state, and `stop` always lands after that frame's final `update`. `settled` and reduced motion compose channel-wise.

The `Shape` type validates shapes at compile time too (interfaces like your own `Vector2` work without index signatures) and rejects non-numeric, optional, or `undefined`-typed channels where they're declared.

Configs apply per channel. Pass a single `SpringDefinition` for every channel, or a shape mirroring the value with configs (or `null` to revert) at any level. A config at a subtree covers every channel below it:

```ts
spring.config = { position: stiff, opacity: defineSpring({ duration: 300, dampingRatio: 1 }) }
```

Configs are `SpringDefinition` instances, built with `defineSpring`. Config positions don't accept bare option objects: a plain object is always a per-channel shape, so any non-config leaf it reaches throws with its path.

Composite springs chain channel-wise. Assign another composite spring of the exact same shape to follow it whole, or name channels individually: each channel of a partial target takes a number or a scalar `SpringSource`. While following, a partial target detaches only the channels it names:

```ts
follower.target = leader

// or mix numbers and live sources per channel
follower.target = {
  opacity: 0.5,
  position: { x: mapSpring(leader, ({ position }) => -position.x) },
}
```

## Reduced motion

Coily respects `prefers-reduced-motion` by default. When it's active, springs snap to their targets instead of animating: retargets and value writes apply instantly, and springs ignore velocity impulses. Events stay coherent (one `update` per change, no `start`/`stop`, and `settled` resolves immediately), so code written against the animated path keeps working.

Control it with the `reducedMotion` system option: `'always'`, `'never'`, or the default `'user'`, which follows the OS setting — a live change finishes in-flight animations instantly. Read `system.reducedMotion` to gate decorative effects (particles, flourishes) in your own code.

## Vue

Call `useSpringSystem()` once near the root of your app. It returns the spring system provided by this component or an ancestor. If none exists, it creates one, provides it to descendants, and starts/stops it with the component lifecycle. It's idempotent, and options apply only when a system is created:

```ts
import { useSpringSystem } from 'coily/vue'

const system = useSpringSystem() // e.g. read system.reducedMotion to gate decorative effects
```

(`provideSpringSystem(system, app?)` remains for plugging in a system you created yourself — mostly useful in tests. You manage `start()`/`stop()` for it.)

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

`useSpring` returns a `SpringRef`: a writable ref of the animated value with `velocity`, `isResting`, and `timeRemaining` refs plus `jumpTo()` attached. The target can be a ref, a getter, or another `SpringRef` (which chains the springs). Options are also reactive: swap configs and the spring reconfigures in place.

A `SpringRef` is also a `SpringSource`, and `useSpring` follows any source: chain through `mapSpring` (`useSpring(mapSpring({ x, y }, ({ x, y }) => Math.hypot(x, y)))`), or pass a getter of a source to switch leaders reactively (`useSpring(() => (split.value ? left : right))`). Following bypasses Vue reactivity — followers subscribe to the backing spring directly — so an effect or getter never gains a dependency on a leader's animation.

Numeric shapes work the same way: pass a record or array (plain, ref, or getter) and get a `CompositeSpringRef`. Reads are the deep-readonly composite value, writes take partial shapes, options accept reactive per-channel config shapes, and passing another `CompositeSpringRef` follows it channel-wise. Deeply reactive targets retarget on nested mutation. For several _independent_ scalar springs, map over the targets (composables are loop-safe): `targets.map((t) => useSpring(t))`.

There's also a renderless `<SpringValue :target="n">` component exposing `{ value, velocity, isResting, timeRemaining, jumpTo }` through its default slot.

`useSpringPool()` covers imperative work: a dynamic set of springs created and disposed at arbitrary times (particles, per-item effects). It returns `createSpring` bound to the provided system. The pool disposes every spring created through it when the component's scope is torn down, so leaked motions are structurally impossible. Disposing a spring manually before that is fine.

## Nuxt

```ts
export default defineNuxtConfig({
  modules: ['coily/nuxt'],
  coily: {
    debug: false, // debug logs active motion counts
    reducedMotion: 'user', // 'user' | 'always' | 'never'
  },
})
```

The module provides a spring system for the whole app (started on the client), auto-imports `useSpring`, `useSpringSystem`, `useSpringPool`, and `defineSpring`, and registers the `SpringValue` component.

## Timing

The built-in ticker advances springs once per displayed frame, so motion is as smooth as the screen it runs on: 60Hz, 120Hz, or adaptive sync. The loop sleeps while every spring is at rest (an idle system schedules no frames) and wakes on the next write. Set `fps` (option/property) to cap the rate: capped ticks land on whole display frames and still receive the true elapsed time. The ticker clamps large frame gaps (e.g. returning from a backgrounded tab) via `lagThreshold` (default 500ms) and `adjustedLag` (default 33ms), so springs don't teleport. For manual stepping, skip `system.start()` and call `system.advance(dtMs)` yourself.

## License

MIT
