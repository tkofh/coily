# Precision

This document explains how coily handles floating-point arithmetic. It covers what coily computes exactly, what it compares with a tolerance, and what `precision` controls. It is the reference for the library's numerical contract. If a behavior contradicts this document, one of the two is a bug.

## The model

Two rules apply everywhere:

1. State and reads are exact IEEE 754 arithmetic. Each solver evaluates the exact formula for its spring's motion from an exact starting state, which this document calls an _anchor_. A retarget recomputes the exact displacement from the new target. A follower chases the exact leader value. `value` and `velocity` return exactly what the arithmetic produced. No operation rounds, snaps, or otherwise changes its result after the fact.
2. Rest is the one yes-or-no decision, and it uses a tolerance. A spring rests when its remaining motion falls inside a threshold that `precision` sets. At rest, coily sets the state exactly to the target.

Rule 1 holds because every floating-point operation rounds correctly. A chain of arithmetic returns the exact trajectory of a spring that starts a few ulps away, where an ulp is one unit in the last place of a float. No consumer can tell that apart from motion that differs by that much. Rounding reads would add nothing, because a browser paints `96.86000000000001px` and `96.86px` the same. Rounded values fed back into state would do harm. Each such write, such as a retarget or a new anchor, adds up to half the rounding step. Under a retarget on every pointer move, the value then drifts.

Rule 2 exists because "has this spring stopped?" is a yes-or-no question. Friction drives the motion toward zero, but the motion never reaches zero exactly. Without a threshold, springs would tick forever. With an exact comparison against zero, the answer would flip back and forth on motion too small to see. The threshold is the one place where coily is approximate on purpose.

## The rest predicate

A spring rests when its _rest amplitude_ is inside the resting threshold:

```
abs(x) + abs(v) / wn <= 0.5 * 10^-precision
```

Here `x` is the displacement from the target and `v` is the velocity. `wn` is the natural frequency, `sqrt(tension / mass)`: how fast the spring would swing with no friction, in radians per second. `precision` defaults to 2, so the default threshold is 0.005.

Both terms are in position units. A velocity `v` is worth `v / wn` of further travel, at the scale that the spring's own stiffness sets. One threshold therefore decides rest for the whole state. A comparison of raw velocity against a position threshold would misjudge rest in both directions. Stiff springs would tick long after their motion stopped being visible. Soft springs would rest while they still had enough velocity to move visibly.

The same threshold drives `timeRemaining` and the duration-based configs, so all three agree about when motion ends. `timeRemaining` reports 0 exactly when the spring is resting. A duration-tuned config is tuned against its own threshold, so it rests on the schedule it advertised at any `precision` (see "Rest time is solved").

The rest amplitude bounds how far the spring can still travel. Friction only takes energy out of the motion, so no later displacement `abs(x)` exceeds the current rest amplitude, at any `dampingRatio`. A spring that rests never cuts off motion that would have left the threshold. The rest amplitude itself does not shrink steadily. Before it decays, it can rise above its current value by a factor of up to `sqrt(2)`, which it approaches as `dampingRatio` nears 0. The worst case is about 1.38 at a `dampingRatio` of 0.1, 1.25 at 0.7, and 1.21 at 1. That rise is why a spring can rest a little before its solved rest time (see "Rest time is solved"). A spring with no friction (`dampingRatio` 0) never rests unless it starts inside the threshold, because no friction means the motion never decays. The exception is an `arrival` multiplier that stops or slows the spring at the target.

## Rest time is solved

`timeRemaining` and the duration-based config shapes share the rest predicate's threshold. Coily solves both from the way the motion decays and does not estimate them. Each kind of spring has an exact formula that bounds its rest amplitude, `abs(x) + abs(v) / wn`, over time:

- A bouncy (underdamped) trajectory is `exp(-sigma*t) * R * f(t)`. Here `sigma` is the decay rate, `dampingRatio * wn`, and `R` is the exact oscillation amplitude. `f` pulses periodically between `sqrt(1 - zeta^2)` and `sqrt(2 + 2*zeta)`, where `zeta` is the `dampingRatio`. Both are exact, so the bound touches the rest amplitude at the peak of each pulse.
- A spring that does not bounce (critically damped or overdamped) moves as the sum of two decaying parts, and the bound sums them.

Coily solves for the time at which that bound enters the threshold. Where the inverse has a simple formula, it solves algebraically. Where it does not, it uses bisection to machine precision. This is the case for the `t * exp(-t)` term of critical damping.

Two kinds of slack remain. Both are one-sided, and both are bounded:

- Coily checks rest once per tick, so rest lands at the first tick at or after the solved time. It lands within one frame, and never later.
- A bouncy spring's rest amplitude pulses below its bound. A frame that lands on a low point of the pulse inside the threshold rests early. It can rest up to `ln(max(f) / min(f)) / sigma` before the solved time, which is `ln(2 / (1 - zeta)) / (2 * sigma)`. That is under one oscillation for a `zeta` above about 0.06, and it grows to several oscillations as `zeta` nears 0. On a 1 ms grid at the default precision, `duration: 500` from displacement 1 rests at 403 ms with `bounce` 0.1 (19% early), 429 ms with 0.3 (14%), and 448 ms with 0.5 (10%). With `displacement: 300` it rests between 465 ms and 499 ms for the same bounces. The motion that an early rest cuts off still never leaves the threshold.

The contract is: never later, within a frame, and possibly earlier, by at most the slack above. A duration-tuned config inverts the same bound with its own threshold, so `duration: 750` rests at 750 ms on the tick grid at any `precision`, not comfortably before it. `arrival` fits into the solution exactly. A multiplier of 0 caps the time at the first target crossing (see "Arrival is exact"). A rebound or a slowdown loses velocity at each crossing, and coily adds that loss to the effective decay rate as `ln(1 / abs(arrival)) * wd / pi`. Here `wd` is the frequency at which the spring actually oscillates. This is also why a spring with no friction and such a multiplier reports a finite time and rests on it.

## Rest is a fixpoint

When a tick lands inside the resting threshold, coily sets the displacement and velocity to exactly zero before it emits the final `update`. Anything that reads the spring during or after that update sees the target itself, not a tiny leftover. This makes rule 1 safe end to end:

- At rest, `value === target` holds bit for bit, even for targets like `77.7731` that float arithmetic would not land on by itself.
- A follower's final retarget sees its leader's target exactly, so chains of springs settle on exact values and do not inherit leftovers.
- A retarget away and back restores the value exactly. Rest is the anchor that keeps repeated retargets free of drift.

## Arrival is exact

An `arrival` multiplier other than 1 (`'passthrough'`) turns each target crossing into an event. Crossings follow rule 1: coily solves them and does not sample them. Each solver knows the exact formula for its motion. Whenever it anchors, it also solves `x(t) = 0` for the first crossing strictly in the future:

- Underdamped: the first `t > 0` with `wd*t = atan2(-c1, c2) (mod pi)`. This crossing always exists.
- Critically damped: `t = -c1/c2`, when it is positive. That happens when the momentum is strong enough to carry the spring through the target.
- Overdamped: `wd*t = atanh(-c2/c1)`, when it is positive.

`c1` and `c2` are the constants that the solver computes from the anchor. A tick that reaches the crossing splits there. The solver evaluates the motion at the crossing time and writes the position as an exact 0. The crossing is defined by `x = 0`, so the solver discards the small error of the evaluation. It then multiplies the velocity by the multiplier, anchors again, and spends the rest of the step from the new anchor. The crossing time is a solved root, not a sampled change of sign, so no step size can miss it. A lag spike that jumps over a whole sequence of bounces still lands every crossing in it, in order.

For `arrival: 'stop'` (multiplier 0), this makes arrival a second exact fixpoint, next to rest. The spring's final update reads `value === target` bit for bit, at the first crossing. No step size renders an overshoot. This includes a spring with no friction, for which a stop is the only way to rest. `timeRemaining` reports the exact time of that crossing whenever it comes before the solved rest time.

A rebound (a negative multiplier) anchors again at every crossing. A long sequence of bounces therefore stays exact piece by piece: error does not build up across crossings, just as it does not build up across frames. A rebounding spring never goes past its target. It rests exactly on the target itself, set there per rule 2.

## Followed targets

Everything above concerns a spring and its own target. Following adds an approximation that an isolated spring never has. A follower's target moves continuously with its leader, but the follower can only read it at discrete points. That sampling is where frame timing could leak into trajectories. Two mechanisms keep it out.

### First-order hold

A _passthrough edge_ is a follower outside any follow cycle, with the default `arrival`. On a passthrough edge, each step does not hold the leader's value from the start of the step. It follows a straight line through the leader's actual motion over the step, which is called a first-order hold. The exact formulas still apply. A target that moves at a constant slope `g` shifts the spring's resting point by the constant `-(damping/tension) * g`. The solver ticks the shifted state exactly and then shifts back. A follower tracks a leader that moves in a straight line exactly, at any step size. A leader that curves leaves an error that shrinks with the square of the step.

### Error-controlled sub-steps

Before each frame, the system estimates the error that each follow edge is about to pick up. The estimate uses the edge's recent frame deltas and its leader's current state. When one step would exceed the edge's tolerance, the system splits the frame into up to 8 equal sub-steps. The tolerance is `max(0.5 * 10^-precision, couplingTolerance)`: the follower's own resting threshold, with the system-wide `couplingTolerance` as a floor. A quiet frame takes one step and costs nothing extra. Teleports, flings, and dropped frames get sub-steps. The estimate is a calibrated heuristic, not a proven bound. The tolerance targets the error within one frame, and the error over a long trajectory adds up to a small multiple of it.

A slope never applies inside a cycle. Around a loop, the velocity part of a slope is always one step out of date, and that can make a cycle unstable that is always stable with held targets. A slope also never applies to a spring with an `arrival`, whose crossings have exact solutions only against a held target. Those edges hold the target constant for each sub-step instead.

### Following a ramp

A ramp (`createRamp`) moves at an exactly constant speed. Its change over any sub-step is `rate * h`, where `h` is the sub-step length, so the first-order hold follows it exactly. A spring with the default `arrival` that follows a ramp matches the continuous motion to rounding, at any frame rate. Two cases leave error, and the sub-step controller budgets for it. A curved map of a ramp, such as `mapSpring(clock, (ms) => Math.sin(ms / 100))`, leaves the same curvature error as any curving leader. A bounded ramp's arrival is a sharp corner inside a frame, which the recent history cannot predict. The ramp knows its arrival time, so that frame takes the full 8 sub-steps. The error that remains comes from an arrival between sub-step boundaries.

### What following preserves bit for bit

- An isolated spring never takes sub-steps. K steps of `dt/K` do not give the same float result as one step of `dt`. A motion outside the follow graph therefore always advances in one exact step per frame.
- Synchronous writes stay events. A retarget, a value write, or a `jumpTo` on a leader reaches its followers as an exact step at the time of the write. It is never spread across the next frame.
- Rest is a fixpoint through any depth of following, and coily still solves arrival crossings and never samples them.

The visible contract is that a chain's shape depends on its springs, not on the frame rate it renders at.

## What stays exact

Two comparisons look like they need a tolerance, but they use exact equality on purpose:

- The no-op check on a retarget (`value !== target`) compares exactly. A target is a value that the user supplies, not a computed one. Coily honors a request for a value one ulp away and does not absorb it.
- The choice of solver on `dampingRatio === 1` picks between exact formulas and makes no claim about the motion. Both neighboring solvers stay stable as the damping ratio approaches 1. A ratio near 1 takes whichever branch it lands in and produces the near-critical trajectory either way.

## Working with the model

`precision` is an absolute resolution. The default assumes values of ordinary UI size, such as pixels, percentages, or degrees. If your values are smaller, raise it. An animation of a scale factor from 1 to 1.005 sits entirely inside the default threshold. It rests and snaps at once, which looks like a teleport. If your values are huge, a lower `precision` ends motion sooner. A duration-tuned config is the exception. It retunes its stiffness against its own threshold, so it rests at its `duration` at any `precision`. A higher precision makes it stiffer, so it covers the extra decimal places in the same time. A displacement below the threshold rests at once by design. Differences smaller than the configured resolution do not count as motion.

For numerical tests, dyadic values such as integers, halves, and quarters never round, so they suit exactness assertions. Non-dyadic values such as `0.1` and `77.7731` exercise real rounding. Exact-equality assertions make the best regression guards. A settled spring lands `toBe` its target, and a retarget round trip restores `toBe` the prior value.
