# coily

Simulate values using spring physics.

Coily animates numbers, and objects or arrays of numbers, with spring motion. It computes each frame from an exact formula for the spring's motion, for bouncy and non-bouncy springs alike, instead of stepping a simulation forward. Error does not build up over a long animation, and you can retarget a spring mid-flight without losing its momentum.

The core has zero dependencies and runs anywhere. Outside the browser, it uses `setTimeout` in place of `requestAnimationFrame`. The Vue and Nuxt integrations are separate entry points, with `vue` and `@nuxt/kit` as optional peer dependencies. A third entry point, `coily/css`, turns a spring config into static CSS.

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

// Animate toward a new target at any time. The value and velocity
// carry over, so an interruption stays smooth.
spring.target = 300
```

## Configuring springs

`defineSpring` accepts several combinations of options and derives the ones you leave out:

```ts
defineSpring({ tension: 500, damping: 40 }) // stiffness and friction, set directly
defineSpring({ tension: 500, dampingRatio: 0.7 }) // damping derived
defineSpring({ tension: 500, bounce: 0.3 }) // bounce = 1 - dampingRatio
defineSpring({ duration: 750, dampingRatio: 1 }) // tuned to rest at about 750 ms
defineSpring({ duration: 750, bounce: 0.5 })
defineSpring({ tension: 500, bounce: 0.9, arrival: 'stop' }) // stops dead at the target, no overshoot
```

- `tension`: stiffness, greater than 0. Higher tension makes the whole motion faster.
- `damping`: friction, 0 or greater. Higher damping slows the spring down faster and reduces bounce.
- `dampingRatio`: friction as a fraction of the amount that just stops the bounce. At 0 the spring never settles. Below 1 it overshoots and bounces. At 1 (critically damped) it settles as fast as it can without overshoot. Above 1 (overdamped) it settles more slowly, still without overshoot.
- `bounce`: another way to set the damping ratio, as `1 - dampingRatio`. It goes from -1 (overdamped) to 1 (maximum bounce).
- `duration`: the settle time in ms. The spring rests at this time, within one frame, and a bouncy config can rest up to one oscillation earlier. The timing assumes that the motion starts 1 unit from the target. For accurate timing, set `displacement` to the range of your animation.
- `mass`: the weight of the moving value. Defaults to 1.
- `precision`: the number of decimal places that decide rest. Defaults to 2. A spring is _resting_ once its remaining motion cannot reach half a unit in the last place, which is 0.005 at the default. Coily never rounds values. Set `precision` to match the resolution of your values (see [PRECISION.md](https://github.com/tkofh/coily/blob/main/PRECISION.md)).
- `arrival`: what the motion does when the value reaches the target. `'passthrough'` (the default) swings through and settles. `'stop'` ends the motion exactly on the target the first time the value gets there, however bouncy the config. A number between -1 and 1 multiplies the velocity at every crossing, and negative values rebound. A spring that never crosses its target ignores `arrival`. For example, a spring with a `dampingRatio` of 1 or above that starts from rest closes in from one side and never crosses. Coily solves each crossing exactly and never samples it frame by frame (see [PRECISION.md](https://github.com/tkofh/coily/blob/main/PRECISION.md)).

Without a config, a spring is critically damped and settles in about 500 ms.

## Spring API

- `spring.target`: set it to animate toward a new value.
- `spring.value`: the current value. Write it to displace the spring.
- `spring.velocity`: the current velocity, in units per second. Write it to fling the spring.
- `spring.acceleration`: the current acceleration, in units per second squared. Read-only.
- `spring.jumpTo(v)`: snap to a value with no animation.
- `spring.config`: assign a new `SpringDefinition`, or `null` to revert to the default.
- `spring.isResting`, `spring.timeRemaining`: whether the spring is resting, and the ms until it rests. Coily solves the time from the motion and does not estimate it (see [PRECISION.md](https://github.com/tkofh/coily/blob/main/PRECISION.md)).
- `spring.settled`: a promise that resolves when the spring next comes to rest, or at once if it is already resting. A retarget mid-flight extends the wait, and `dispose()` resolves it. Use `await spring.settled` to run animations in sequence.
- `spring.onUpdate(cb)`, `onStart(cb)`, `onStop(cb)`, `onDispose(cb)`: subscribe to events. Each returns an unsubscribe function. `start` fires when the spring leaves rest, and `stop` fires when it settles. The two always alternate, and a retarget mid-flight fires neither.
- `spring.dispose()`: release the spring. A second call does nothing.

### Chaining

A spring can follow another spring's live value instead of a fixed number. Assign a spring to `target`, or pass one to `createSpring` to follow it from creation. `mapSpring` derives new values that springs can follow, such as offsets, mirrors, clamps, or any pure function of the value:

```ts
const leader = system.createSpring(0)

const follower = system.createSpring(leader)
const trailing = system.createSpring(mapSpring(leader, (v) => v + 20))
const mirrored = system.createSpring(mapSpring(leader, (v) => -v))
```

A follower keeps its own config. Following changes what a spring chases, never how it moves. To match a leader's feel, pass the leader's config at creation, as in `system.createSpring(leader, leader.config)`, or share one `defineSpring` constant. Assign a number to `target` to stop following.

`mapSpring` also combines several springs. Pass a shape, which is a plain object or array with springs at the leaves, nested to any depth, and a function of their values:

```ts
const x = system.createSpring(0)
const y = system.createSpring(0)

const distance = system.createSpring(mapSpring({ x, y }, ({ x, y }) => Math.hypot(x, y)))
```

A composite spring (see below) is a source of its whole value shape, so one map can derive a single number from every channel at once:

```ts
const point = system.createSpring({ x: 3, y: 4 })

const magnitude = system.createSpring(mapSpring(point, ({ x, y }) => Math.hypot(x, y)))
```

A mapped value is a `SpringSource`. `target` accepts this type, and every `Spring` implements it. A `CompositeSpring` is a source _of its shape_. `mapSpring` can read it, alone or at the leaves of a shape, but a single-number spring can follow only a single-number source.

Chains advance in dependency order. Each frame, a spring moves after the springs it follows, whatever order you created or connected them in. A follower therefore chases its leader's value for the current frame, not the previous one. Update events fire once per spring per frame, after every spring has moved, in the same leader-first order. A callback that reads another spring sees that spring's final value for the frame. A spring that a callback retargets starts moving on the next frame.

Following is accurate within a frame, too. A follower moves against the path its leader traveled during the frame, not one value sampled at the frame boundary. Sometimes one frame carries more motion than the system's `couplingTolerance` allows, which is 0.1 value units by default. The system then splits that frame into internal sub-steps. Dropped frames and targets that jump get these sub-steps automatically, and update events still fire once per frame. As a result, a chain keeps the same shape at 30fps as at 120fps. See [PRECISION.md](https://github.com/tkofh/coily/blob/main/PRECISION.md) for the model.

Follow graphs can contain cycles. A retarget emits no `update`, so nothing loops within a frame. Mutual followers converge to a shared value, and that value is the same at any frame rate. A cycle has no order that puts every member after its leaders. Its members advance in creation order, and the edge that closes the loop chases one frame behind. When the maps in a cycle push the values apart, such as `(v) => v + 10` in both directions, the springs chase forever and never rest. The system stays awake until you break the cycle.

### Composites

`createSpring` also takes a numeric shape: a plain object or array, nested to any depth, whose leaves are all numbers. Each leaf becomes an independent channel behind one composite API, a `CompositeSpring`:

```ts
const spring = system.createSpring({ position: { x: 0, y: 0 }, opacity: 1 })

spring.target = { position: { x: 100 } } // a partial target leaves the other channels alone
spring.value // { position: { x, y }, opacity }, a read-only object that every read refreshes
```

The shape is fixed at creation. An unknown channel throws an error that names its path (`position.z`). `value`, `velocity`, and `jumpTo` take the same partial shapes. A composite coalesces its events. `update` fires at most once per frame, with every channel in its final state for that frame, and `stop` always comes after that frame's final `update`. `settled` and reduced motion apply channel by channel.

The `Shape` type also checks shapes at compile time. Interfaces such as your own `Vector2` work without index signatures. It rejects channels that are non-numeric, optional, or typed `undefined` where you declare them.

Configs apply per channel. Pass one `SpringDefinition` for every channel, or a shape that mirrors the value. The shape can hold a config, or `null` to revert to the default, at any level. A config at a subtree covers every channel below it:

```ts
const stiff = defineSpring({ tension: 800, dampingRatio: 1 })

spring.config = { position: stiff, opacity: defineSpring({ duration: 300, dampingRatio: 1 }) }
```

A config is a `SpringDefinition` instance, built with `defineSpring`. A config position does not accept a bare options object. Coily always reads a plain object as a per-channel shape, so any leaf in it that is not a config throws an error that names its path.

A composite spring follows channel by channel. To follow another composite spring as a whole, assign it to `target`. The two must have exactly the same shape. You can also name channels one at a time, and each channel of a partial target takes a number or a single-number `SpringSource`. While the composite follows, a partial target detaches only the channels it names:

```ts
follower.target = leader

// or mix numbers and live sources per channel
follower.target = {
  opacity: 0.5,
  position: { x: mapSpring(leader, ({ position }) => -position.x) },
}
```

### Velocity, acceleration, and target

`velocityOf`, `accelerationOf`, and `targetOf` each turn one part of a moving value into a source. `velocityOf` reads its velocity in units per second, `accelerationOf` reads its acceleration in units per second squared, and `targetOf` reads where it is heading. A spring can follow the result, and `mapSpring` can shape it:

```ts
const x = system.createSpring(0)

// A blur that grows with speed: a spring follows a map of x's velocity.
const blur = system.createSpring(mapSpring(velocityOf(x), (v) => Math.abs(v) / 100))

// The distance x has left to travel, measured against where it is heading.
const remaining = system.createSpring(
  mapSpring({ value: x, target: targetOf(x) }, ({ value, target }) => target - value),
)
```

All three accept a `Spring`, a `CompositeSpring`, a ramp, or a Vue ref that wraps one. A composite gives a result of the same shape. A `mapSpring` result has no velocity or target of its own, so all three reject it. The result is a view, not a spring, and needs no disposal.

### Ramps

A ramp is a value that moves toward its target at a fixed speed, in a straight line, and stops there. It is a source like a spring, so a spring can follow it:

```ts
// An endless spin at 270 deg/s. The spring trails it like an object with inertia.
const sweep = system.createRamp(0, { rate: 270, target: Infinity })
const ring = system.createSpring(sweep)

// A heading that turns at no more than 400 deg/s: retarget the ramp, not the spring.
const slew = system.createRamp(0, { rate: 400 })
const core = system.createSpring(slew)
slew.target = 180

// A clock in ms, mapped into a 600 ms pulse.
const clock = system.createRamp(0, { rate: 1000, target: 600 })
const pulse = system.createSpring(mapSpring(clock, (ms) => Math.sin((Math.PI * ms) / 600)))
```

Following a ramp is exact. The spring moves against the ramp's steady motion. By contrast, a target that you write once per frame reaches the spring as a staircase, about half a frame behind.

A ramp has the parts of the spring API that apply to it. These are `value`, `target`, `rate`, a read-only `velocity`, `isResting`, `timeRemaining` in ms, `settled`, `jumpTo`, `dispose`, and the same four events. You can write `value`, and the ramp carries on from where you put it. A `target` of `Infinity` or `-Infinity` makes the ramp endless. `rate` is in units per second. `velocityOf`, `accelerationOf`, and `targetOf` accept a ramp.

A ramp's value is a function of time. A ramp costs nothing per frame unless something listens to it frame by frame. An update listener does, and every follower is one. On a bounded ramp, a stop listener or a pending `settled` does too. A ramp that nothing watches keeps moving on the system's clock and reports its position when you read it. The clock counts frames, `advance` calls, and the time a started system sleeps. It stops while the system is stopped or the page is hidden.

## Reduced motion

Coily follows `prefers-reduced-motion` by default. When it is on, springs snap to their targets instead of animating. Retargets and value writes apply at once, and springs ignore velocity writes. Events stay consistent: one `update` per change, no `start` or `stop`, and `settled` resolves at once. Code written for the animated path keeps working.

Ramps follow the same rule. A ramp jumps to a bounded target, and an endless ramp holds still until reduced motion turns off. A value that moves nothing on screen, such as a cross-fade, a color, or a clock that drives logic, takes `purpose: 'nonmotion'` and keeps animating. `createSpring`, `createRamp`, `useSpring`, and `useRamp` take `purpose` in their options, and `<SpringValue>` takes it as a prop.

Control it with the `reducedMotion` system option: `'always'`, `'never'`, or the default `'user'`, which follows the OS setting. When the OS setting turns on, animations in flight finish at once. Read `system.reducedMotion` to turn off decorative effects in your own code, such as particles.

## Vue

Call `useSpringSystem()` once near the root of your app. It returns the spring system that this component or an ancestor provides. If none exists, it creates one, provides it to descendants, starts it on mount, and disposes it on unmount. A second call in any descendant returns the same system. Options apply only when the call creates a system:

```ts
import { useSpringSystem } from 'coily/vue'

const system = useSpringSystem() // for example, read system.reducedMotion
```

`provideSpringSystem(system, app?)` supplies a system that you created yourself, which is mostly useful in tests. You call `start()`, `stop()`, and `dispose()` on that system yourself.

Then animate anywhere below:

```vue
<script setup>
import { ref } from 'vue'
import { useSpring } from 'coily/vue'

const target = ref(0)
const x = useSpring(target, { duration: 500, bounce: 0.3 })
</script>

<template>
  <div class="ball" :style="{ translate: `${x}px 0` }" @click="target = 300" />
</template>
```

`useSpring` returns a `SpringRef`: a writable ref of the animated value, with `velocity`, `isResting`, and `timeRemaining` refs, `settled`, and `jumpTo()` attached. The target can be a ref, a getter, or another `SpringRef`, which chains the two springs. The config is reactive too. When it changes, the spring reconfigures in place.

A `SpringRef` is also a `SpringSource`, and `useSpring` follows any source. Chain through `mapSpring`, as in `useSpring(mapSpring({ x, y }, ({ x, y }) => Math.hypot(x, y)))`. Or pass a getter that returns a source to switch leaders reactively, as in `useSpring(() => (split.value ? left : right))`. Following bypasses Vue reactivity, because a follower subscribes to the backing spring directly. An effect or getter therefore never gains a dependency on a leader's animation.

Numeric shapes work the same way. Pass a record or array, as a plain value, a ref, or a getter, and you get a `CompositeSpringRef`. Reads return the deep-readonly composite value, and writes take partial shapes. The config can be a reactive per-channel config shape. Pass another `CompositeSpringRef` to follow it channel by channel. A deeply reactive target retargets when a nested property changes. For several _independent_ single-number springs, map over the targets, since composables are safe to call in a loop: `targets.map((t) => useSpring(t))`.

`useRamp(target, rate, { from, purpose })` returns a `RampRef`: a writable ref of a ramp's value, with `velocity`, `isResting`, and `timeRemaining` refs, `settled`, and `jumpTo()`. `target` and `rate` take numbers, refs, or getters. `from` defaults to the initial target, and you must pass it when the target starts infinite. The ramp stays in the frame loop while something reads the ref, and `useSpring(rampRef)` follows the ramp directly:

```ts
const angle = useRamp(Infinity, 270, { from: 0 })
const ring = useSpring(angle, { duration: 300, dampingRatio: 1 })
```

A renderless `<SpringValue :target="n">` component exposes `{ value, velocity, isResting, timeRemaining, jumpTo }` through its default slot.

`useSpringPool()` is for imperative work: a changing set of springs that you create and dispose at any time, such as particles or per-item effects. It returns `createSpring` bound to the provided system. When the component's scope ends, the pool disposes every spring created through it, so no pooled spring outlives its component. You can still dispose a spring yourself before that.

## Nuxt

```ts
export default defineNuxtConfig({
  modules: ['coily/nuxt'],
  coily: {
    debug: false, // log active motion counts to the console
    reducedMotion: 'user', // 'user' | 'always' | 'never'
  },
})
```

The module provides one spring system for the whole app and starts it on the client. It auto-imports `useSpring`, `useRamp`, `useSpringSystem`, `useSpringPool`, `defineSpring`, `mapSpring`, `velocityOf`, `accelerationOf`, and `targetOf`, and registers the `SpringValue` component. The `coily` key also accepts the system options `fps`, `lagThreshold`, `adjustedLag`, and `couplingTolerance`.

## CSS

`coily/css` turns a spring config into static CSS: a `linear()` easing and a duration in ms to pair it with. It needs no DOM and no ticker, so it can run at build time:

```ts
import { defineSpring } from 'coily'
import { springToWaapi } from 'coily/css'

const config = defineSpring({ duration: 500, bounce: 0.3, displacement: 300 })
const { keyframes, options } = springToWaapi(config, {
  property: 'translate',
  from: 0,
  to: 300,
  unit: 'px',
})
element.animate(keyframes, options)
```

`springToLinear` returns the easing and its duration alone. `springToCss` returns a `@keyframes` rule and an `animation` value, and `springToTransition` returns a `transition` value. `springFromState` and `springStateAt` let you continue an interrupted animation with its momentum. A config with a `dampingRatio` of 0 and the default `arrival` never rests. `springToLinear`, `springToWaapi`, and `springToCss` turn it into an endless alternating loop, and `springToTransition` throws for it.

## Timing

The built-in ticker advances springs once per displayed frame, so motion is as smooth as the screen allows: 60Hz, 120Hz, or adaptive sync. The loop sleeps while every spring is resting, so an idle system schedules no frames. It wakes on the next write. Set `fps`, as an option or a property, to cap the rate. Capped ticks land on whole display frames and still receive the true elapsed time. The ticker clamps large gaps between frames, such as when a backgrounded tab comes back, so springs do not teleport. A gap longer than `lagThreshold` (default 500 ms) counts as `adjustedLag` (default 33 ms). For manual stepping, skip `system.start()` and call `system.advance(dtMs)` yourself. Each system listens for page visibility and, by default, the reduced-motion setting. Call `system.dispose()` to remove those listeners when you no longer need the system.

## License

MIT
