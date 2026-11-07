# Ramps: constant-rate sources

A **ramp** is a value that moves toward its target at a fixed speed. It is a
`SpringSource`, so a spring can follow it, and the spring integrates against
the ramp's motion exactly instead of chasing a target that jumps once per
frame. This document proposes `system.createRamp` and `useRamp`, shows the
accuracy a ramp buys with probes against a continuous-time reference, and
lists what the core needs to host a member in its tick that isn't a spring.

The probes live in `probes/ramp/` and run with `node probes/ramp/<file>.ts`.
`proto.ts` is the prototype: a `Motion` subclass wired into the real
`MotionSet` and `FollowGraph`, so its followers are ranked, sub-stepped, and
recoupled by the shipped code.

## Problem

A target moving at constant speed is a common driver for a spring. In
ghost-studio a ring spins with its target running ahead at 270 deg/s, and a
spring tracks it, so the lag reads as inertia. A large turn sweeps its target
at 400 deg/s, so the core slews like a motor instead of whipping round. A
pulse plays a fixed shape over 600 ms.

Today the caller computes `from + rate * t` every frame and assigns it to
`target`. The spring sees a staircase: the target jumps at the frame boundary
and holds still across the frame. Against the continuous motion the caller
meant, the follower is off by about half a frame of travel, every frame.
Writing the target also needs a hook that runs before the springs advance,
which coily lacks.

## The ramp

```ts
// Endless spin. The spring follows the ramp, lagging 2*zeta/wn * rate behind it.
const sweep = system.createRamp(spin.value, { rate: 270, target: Infinity })
spin.target = sweep

// Land: the spring takes a numeric target again, and the ramp stops.
spin.target = landingAngle(spin.value, spin.velocity)
sweep.jumpTo(spin.value)

// Bounded slew, wired once. Each turn retargets the ramp, not the spring.
const slew = system.createRamp(core.value, { rate: 400 })
core.target = slew
slew.target = nextHeading

// A time-shaped target: a ramp over milliseconds, mapped to the shape.
const clock = system.createRamp(0, { rate: 1000, target: 600 })
ring.target = mapSpring(clock, (ms) => 20 * Math.sin((Math.PI * ms) / 600))
```

The examples show the target API and have not been run. The probes exercise
the same behavior through the prototype.

A ramp carries the surface of a `Spring` where the meaning carries over:

- `value`: the current value. Assignment moves the ramp there at once. It
  keeps its target and rate and carries on from the new value.
- `target`: where the ramp is heading. Assignment takes any number, and
  `Infinity` or `-Infinity` makes the ramp endless in that direction. The ramp
  heads to a new target from its current value at its current rate.
- `rate`: speed in value units per second, finite and at least 0. Assignment
  applies from the next step. A rate of 0 rests the ramp where it is.
- `velocity`: `rate` signed toward the target while moving, 0 at rest.
  Read-only.
- `acceleration`: always 0. Read-only.
- `isResting`, `timeRemaining` (ms, `Infinity` for an endless ramp), `settled`.
- `onUpdate`, `onStart`, `onStop`, `onDispose`, `jumpTo(value)`, `dispose()`,
  with the event contract springs have. `jumpTo` sets both value and target,
  so the ramp rests there.

`createRamp(from, options)` takes `rate` (required), `target` (default
`from`, so the ramp starts at rest), and `purpose` (default `'motion'`). A ramp
is a `TargetedSource`, so `velocityOf`, `accelerationOf`, and `targetOf` accept
it. A spring following `targetOf` of an endless ramp throws, because a spring
target must be finite.

### Lifecycle

A ramp's value is a function of time. The ramp holds an **anchor**, a value
at a moment on the system clock, and reads as the anchor value plus
`velocity * (now - anchorTime)`, clamped at the target. Every assignment to
`value`, `target`, or `rate` re-anchors the ramp at its current value.

A moving ramp ticks only while something needs it frame by frame:

- an `onUpdate` listener, which includes every spring that follows the ramp
  or a source derived from it;
- on a bounded ramp, an `onStop` listener or a `settled` promise that has not
  resolved, since each needs the arrival as it happens.

A ramp with none of these leaves the tick and lets the system sleep. It keeps
its anchor, so a read of `value`, or a listener that subscribes later, finds
the ramp where it would have been had it ticked the whole time. A follower
that detaches and reattaches sees the ramp further along and retargets to it,
as it would to any new target. A bounded ramp that nothing watches reaches its
target without events, and reads as resting from that moment.

A ramp moves until it reaches its target, its rate is set to 0, or it is
disposed. An endless ramp counts until the caller stops it, the way a timer
runs until it is cleared, but an endless ramp nothing watches costs nothing
per frame.

### The system clock

Catching up needs a clock that runs while the system sleeps. The system keeps
one, in ms. Every tick adds its elapsed time: the lag-clamped frame time on
real frames, or the `dt` of `advance`. While the system is started and
asleep, the clock also counts wall time, so an idle page still moves its
unwatched ramps. A stopped system freezes the clock, as it holds its springs.
A system driven only by `advance` never counts wall time, which keeps manual
stepping deterministic.

The clock is internal. A ramp from 0 at 1000 per second is its public face.

A hidden tab is where the clock and a ticking ramp could disagree. When
frames resume, a ticking ramp sees the hidden gap replaced with `adjustedLag`.
To match, the clock stops counting wall time while the document is hidden, so
a ramp unwatched through a hidden spell trails a watched one by at most
`adjustedLag` ms of travel.

### Reduced motion

Under reduced motion a `'motion'` ramp behaves like a `'motion'` spring.
Assigning a bounded target jumps the ramp there, and switching reduced motion
on finishes bounded ramps at their targets.

An endless ramp has no target to jump to, so it holds. Reduced motion
re-anchors it at its current value with velocity 0, and when reduced motion
turns off, it re-anchors at the held value and resumes at its rate. A value
assigned while the ramp is held is where it resumes from. The system keeps a
set of its moving ramps, watched or not, so a change of setting reaches an
unwatched ramp too.

Followers of a held ramp see a still target and come to rest, so a spin
driven by an endless ramp stops under reduced motion and starts again when it
turns off. Moving the ramp and letting each `'motion'` follower jump to it
every frame would leave a spin running in steps, which is still motion.

A ramp used as logical time, such as a behaviour clock, has to run whatever
the setting, because its value moves nothing on screen. It takes
`purpose: 'nonmotion'`, which runs regardless, as a `'nonmotion'` spring does.

### The `'nonmotion'` purpose

`'appearance'` names values that change how something looks: a cross-fade, a
color, a blur. A clock changes nothing on screen, yet needs the same
treatment, so the name no longer covers its members. What they share is that
the value moves nothing, and `'nonmotion'` says exactly that. Its uses are
rare, and a caller opting a value out of reduced motion is better served by
the plain word than by a short one.

`Purpose` becomes `'motion' | 'nonmotion'`, and `'appearance'` is removed
with no alias. Every place that takes a purpose changes with it:
`createSpring`, purpose shapes on composites, `useSpring`,
`useSpringPool().createSpring`, and the `<SpringValue>` `purpose` prop. An
`'appearance'` passed at runtime throws with the existing invalid-purpose
error, which lists the accepted words.

The rename touches only springs and ships ahead of ramps in its own PR, with
a minor changeset that marks the break and names the replacement.

### Vue

```ts
const angle = useRamp(Infinity, 270, { from: 0 })
const ring = useSpring(angle, { duration: 300 })
// template: <div :style="{ rotate: `${ring}deg` }" />
```

`useRamp(target, rate, options?)` follows the shape of `useSpring(target,
config, options)`:

- `target`: a number, or a ref or getter of one. A change retargets the ramp.
- `rate`: a number, or a ref or getter of one. A change applies from the next
  step.
- `options.from`: the starting value. It defaults to the initial target, so
  the ramp starts at rest, and an infinite initial target without `from`
  throws. Read once.
- `options.purpose`: as on `createRamp`. Read once.

It returns a `RampRef`: a writable ref of the value, where a write places the
ramp, with `velocity`, `timeRemaining`, and `isResting` refs plus `settled`
and `jumpTo`. A `RampRef` is a `TargetedSource`, so `useSpring` follows it and
`velocityOf` and `targetOf` accept it. The ramp is disposed with the
component's scope, and the Nuxt module auto-imports `useRamp`.

A `RampRef` subscribes to its ramp when it is read and drops the
subscription once nothing reads it. A `customRef` cannot tell when its last
reader leaves, so the ref infers it from the triggers:

- Each ramp update triggers the ref and marks it unread.
- Any read of `value`, `velocity`, `timeRemaining`, or `isResting` clears the
  mark, and subscribes if the ref is not subscribed.
- An update that finds the ref still unread unsubscribes it instead of
  triggering. No effect re-ran on the previous trigger, so nothing tracks the
  ref.

Real frames run after Vue flushes its effects, so a tracked ref is always read
between two updates. A `useRamp` in a template ticks while it renders, and a
`useRamp` read only in event handlers ticks for two frames after each read.
Followers are separate: `useSpring(rampRef)` subscribes through the source,
not through the ref.

`r3-vue-subscribe.ts` checks the scheme with a stand-in ramp whose value is
an anchor formula. Six cases pass:

- a `watchEffect` stays subscribed while it runs and drops the ramp when its
  scope stops;
- a `watch` with `flush: 'post'` sees every frame;
- a `computed` read once from plain code drops the ramp, and a later read
  catches up;
- a `computed` that an effect watches keeps the ramp;
- a ref read only from plain code drops the ramp after two frames and catches
  up on the next read;
- two `advance` calls with no flush between them drop the ramp early, and the
  pending effect reads the caught-up value and resubscribes.

A mounted component checks the same way under happy-dom. A `v-if` that hides
the reader drops the ramp, and showing it again renders the caught-up value.
A `KeepAlive` child keeps re-rendering while deactivated, so its ramp ticks
until the child unmounts, as a spring in the same place would. The
implementation promotes these cases to `test/vue/use-ramp.spec.ts`.

Two `advance` calls with no flush between them are the one place the
inference misfires. It drops a ref an effect still tracks, and the cost is
one resubscription. A read always resubscribes, so no reader ever sees a
stale value.

## Accuracy

The reference is RK4 at h = 1e-5 s on the core's continuous model (C1 in
`docs/follower-coupling/math-report.md`), with the target evaluated
continuously and integrated to the same frame boundaries the library steps
through. Errors are the maximum deviation over 2 s, in degrees, for a
critically damped spring with `duration: 300`. A `bounce: 0.3` spring with
`duration: 400` gives the same picture within a few percent.

**R1.** A spring following a ramp matches the continuous reference to the
reference's own precision. The staircase is off by about half a frame of
travel (`r1-accuracy.ts`).

| Drive                   | Wiring    | 120 fps | 60 fps | 30 fps | 60 fps, jitter |
| ----------------------- | --------- | ------- | ------ | ------ | -------------- |
| Endless, 270 deg/s      | ramp      | 1.4e-9  | 2.5e-9 | 2.7e-9 | 4.0e-10        |
| Endless, 270 deg/s      | staircase | 1.13    | 2.25   | 4.52   | 3.00           |
| Slew 180 deg, 400 deg/s | ramp      | 2.5e-9  | 2.5e-9 | 0.52   | 0.042          |
| Slew 180 deg, 400 deg/s | staircase | 1.67    | 3.33   | 6.69   | 3.94           |
| Pulse, 600 ms           | ramp      | 3.1e-3  | 1.2e-2 | 5.0e-2 | 1.7e-2         |
| Pulse, 600 ms           | staircase | 0.39    | 0.77   | 1.53   | 0.91           |

Jittered frames draw each step uniformly from 0.5 to 1.5 times 16.7 ms. The
staircase rows assign `target = T(t)` before each step. Assigning the
end-of-frame value `T(t + dt)` instead changes them by at most 4%.

The mechanism already ships. On a follow edge whose leader moves, `recouple`
arms the follower's first-order hold with the leader's change over the
sub-step, and the solver integrates exactly against a target moving at that
constant slope. A ramp's change over any sub-step is `rate * h`, so the hold
is exact. The sub-step controller agrees: with steady frames it demands one
sub-step on every frame after the ramp starts, because a constant slope has
no curvature. The ramp's own start is a real kink, and the first two frames
take 2 to 4 sub-steps.

The pulse is a curved target, so it carries the curvature residual the
controller budgets with `couplingTolerance`, and it lands within that budget.

**R2.** A bounded ramp's arrival is a kink inside a frame. The controller
plans from history, which cannot see the arrival coming, so the arrival frame
runs as one sub-step and the hold spreads the change of slope over the whole
frame. The ramp knows its arrival time exactly. Demanding the sub-step cap (8)
on the frame where it arrives removes most of the error (`r2-arrival-kink.ts`,
arrival swept across the frame):

| Frame rate | Worst error, plain | Worst error, cap on arrival frame |
| ---------- | ------------------ | --------------------------------- |
| 60 fps     | 0.137              | 1.4e-3                            |
| 30 fps     | 0.523              | 5.6e-3                            |

The error vanishes when the arrival falls on a sub-step boundary and peaks
when it falls mid-sub-step. The R1 slew arrives on a frame boundary at 60 and
120 fps, which is why only its 30 fps and jittered runs show error. Splitting
the frame at the arrival instant would be exact, but sub-steps are uniform
today and the cap already brings the error two orders of magnitude below the
plain case.

## Implementation

1. **A `Motion` base class.** `Motion` is the abstract class that `MotionSet`
   ticks and `FollowGraph` orders: `isResting`, `velocity`, `acceleration`,
   `advance`, `endFrame`, `applyReducedMotion`, and, read from leaders,
   `manifoldDeviation` and `kinksWithin`. `SpringMotion` and `RampMotion`
   extend it. It also carries the scheduler's bookkeeping as plain fields:
   the creation id, the pass and frame markers, the rank, the edge the
   motion follows through, and the edges that read it. `Spring` and `Ramp`
   hold their motion in a private field, so none of it reaches the public
   api. `FollowEdge`'s `cyclic` flag is a plain field the graph writes, and
   the sub-step estimator's history is a `TargetTrail`.
   `resolveLeaderMotions` tells a motion from a composite's channel list
   with `Array.isArray`.
2. **The clock.** `MotionSet.tick` adds each tick's `dt`, which covers both
   the ticker and `advance`. The ticker credits wall time from the moment it
   sleeps to the moment it wakes, minus time the document spent hidden, and
   credits nothing while stopped.
3. **`RampMotion`.** Between frames its value is the anchor formula at the
   clock. Within a frame it steps by `rate * h` per sub-step and clamps on
   arrival, landing on the anchor formula at the frame's end. Its manifold
   deviation and acceleration are 0, so it never trips the controller's shock
   gate.
4. **Subscription tracking.** The ramp counts its `onUpdate` listeners, and
   on a bounded ramp its `onStop` listeners and unresolved `settled` promise.
   It joins the `MotionSet` when the count leaves 0 while moving and leaves it
   when the count returns to 0.
5. **The reducible set.** `MotionSet.reducible` holds the `'motion'` ramps
   that are moving or holding, watched or not. A reduced-motion change calls
   `applyReducedMotion` on those and on every active motion: springs finish,
   bounded ramps finish at their targets, and endless ramps hold and resume.
6. **Arrival demand.** The plan pass asks each ticking ramp whether it arrives
   within `dt`. If it does, every edge it leads demands the sub-step cap for
   that frame.
7. **Rename the first-order-hold slope.** `Motion._ramp` becomes a private
   `#slope` on `SpringMotion`, armed through `armSlope`. The old name predates
   the public word and would collide with it in every comment that touches
   both.
8. **Public surface.** `SpringSystem.createRamp`, the `Ramp` and `RampOptions`
   types, and exports from `coily`. `useRamp` and `RampRef` from `coily/vue`,
   with `useRamp` in the Nuxt auto-imports.
9. **Bench gate.** The tick's hot loop calls `advance` on two classes where it
   called one. Measured with interleaved runs of the chain benches against
   the code before this change, medians matched by name:
   - While only springs have ticked in the process, the chains run at parity
     (0.99x to 1.07x).
   - Once a ramp has ticked, the call sites see two classes and the chains
     run 2% to 5% slower (0.95x to 0.98x). A ramp-led chain bench runs first
     in its group to hold that state. Skipping the arrival query when no ramp
     ticks made no measurable difference, so it was left out.

   A separate `MotionNode` holding the bookkeeping was tried and dropped. On
   the built package it ran follow chains 1% to 6% slower, because the
   ordered tick reached each motion through its node, and it did not recover
   the two-class cost, which comes from the `advance`, `isResting`, and
   `endFrame` calls. With the fields on `Motion`, measured in plain node
   against the code before the restructure, creation runs about 4% faster
   (a spring motion carries fewer fields), springs with no follows and
   spring-led chains run at parity, and chains after a ramp has ticked run
   about 2% faster.

Docs: a README section on ramps, and a paragraph in PRECISION.md on what is
exact (a spring following a ramp) and what is budgeted (a curved map of a
ramp, an arrival off a sub-step boundary).

## Related finding: jitter reads as curvature

The controller estimates curvature from the follower's frame-to-frame target
deltas, `|d - d_prev| / 8`. Under uneven frames a constant speed produces
uneven deltas, which the estimator reads as curvature. In the jittered R1 run,
78 of 120 frames took 2 or 3 sub-steps for an endless ramp that needed 1. The
same holds for any spring leader moving at steady speed through uneven frames.
Comparing slopes (`d / dt`) instead of deltas removes the false demand. It is
a change to the shipped controller and goes in its own PR, with its own probe,
ahead of or independent of ramps.

## Follow-up: a ramp that follows a source

`ramp.target = source` makes a ramp a rate limiter: it chases a moving source
at no more than `rate`. This is the slew case without retargeting by hand. It
makes the ramp a follower in the graph, which brings cycles and edge planning
with it, so it ships after this change. Nothing here closes it off: the
`target` setter takes a number now and widens to a `SpringSource` later.

## Alternatives considered

- **A frame hook and a staircase.** It is what ghost-studio does today. It
  needs a "before" hook coily lacks, and it leaves the R1 staircase error.
- **A clock source.** A system-wide source whose value is elapsed ms, with
  ramps written as `mapSpring(clock, (t) => from + rate * t)`. Followers get
  the same exactness, but a clock never rests, so anything following it keeps
  the system awake after a bounded ramp has finished. A ramp at 1000 per
  second is a clock that can stop.
- **A target rate on the spring.** `spring.targetRate = g` would expose the
  first-order hold directly. It cannot drive several followers, cannot be
  mapped into a pulse, and needs its own endpoint semantics. A ramp gets all
  three from the source machinery.
- **A ramp that always ticks while moving.** Simpler, with no clock and no
  subscription count, but an unwatched endless ramp keeps the system awake
  forever.
- **A ramp that freezes while unwatched.** It makes `ramp.value` depend on who
  is listening, so a follower that briefly detaches would freeze the timeline
  it reads.
- **A clock that counts hidden time.** It puts an unwatched ramp where wall
  time says it should be, but ahead of a watched one, so a follower that
  attaches after a hidden spell sees a jump a watched ramp never makes.
- **A `RampRef` subscribed for its scope's life.** Simpler, but a `useRamp`
  read only in handlers keeps the system awake while its component lives.
