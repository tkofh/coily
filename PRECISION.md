# Precision

This document explains how coily handles floating-point arithmetic. It covers what coily computes exactly, what it compares with a tolerance, and what `precision` controls. It is the reference for the library's numerical contract. If a behavior contradicts this document, one of the two is a bug.

## The model

Two rules apply everywhere:

1. Motion is closed-form, and reads are unrounded. Each solver evaluates the formula for its spring's motion at the time since its last starting state, which this document calls an _anchor_. A retarget recomputes the displacement from the new target. A follower, a spring whose target is another spring or source (its leader), chases its leader's current value. `value` and `velocity` return the floating-point result as computed. Apart from rest (rule 2) and arrival crossings (see "Arrival is exact"), coily never rounds or snaps a result after the fact.
2. For a spring and its own target, rest is the one yes-or-no decision, and it uses a tolerance. A spring rests when its remaining motion falls inside a threshold that `precision` sets. At rest, coily sets the state exactly to the target.

Closed forms remove integration error: the error a step-by-step simulation picks up each frame and carries into the next. For a spring with a fixed target, the step size adds nothing beyond rounding, and only the rounding of elapsed time (below) carries across frames. Closed forms do not remove floating-point evaluation error, which has three sources:

- `Math.exp`, `Math.sin`, `Math.atan`, and the other transcendental functions are not required to round correctly, so engines can differ in the last bits.
- A retarget stores the rounded displacement `value - target`, so `target + displacement` can read back an ulp (one unit in the last place) away from the value before it.
- The time since an anchor is a running sum of step lengths, which rounds once per step.

Each source adds error on the order of an ulp of the values involved. Where a formula would cancel, the solvers use a form that avoids it: the hyperbolic form near critical damping, and a rationalized slow decay rate at very large damping ratios. Coily makes no general claim about how far a long trajectory can drift from the real-number one. The accuracy figures in this document state the conditions they were measured under.

Rounding reads would add nothing, because a browser paints `96.86000000000001px` and `96.86px` the same. Rounded values fed back into state would do harm. Each such write, such as a retarget or a new anchor, adds up to half the rounding step. Under a retarget on every pointer move, the value then drifts.

Rule 2 exists because "has this spring stopped?" is a yes-or-no question. Friction drives the motion toward zero, but the motion never reaches zero exactly. Without a threshold, springs would tick forever. With an exact comparison against zero, the answer would flip back and forth on motion too small to see. In a spring's own motion, the threshold is the one place where coily is approximate on purpose. `timeRemaining` is a bound rather than a prediction (see "Rest time is solved"), and following adds a second approximation (see "Followed targets").

## The rest predicate

A spring rests when its _rest amplitude_ is inside the resting threshold:

```
abs(x) + abs(v) / wn <= 0.5 * 10^-precision
```

Here `x` is the displacement from the target and `v` is the velocity. `wn` is the natural frequency, `sqrt(tension / mass)`: how fast the spring would swing with no friction, in radians per second. `precision` defaults to 2, so the default threshold is 0.005.

Both terms are in position units. A velocity `v` is worth `v / wn` of further travel, at the scale that the spring's own stiffness sets. One threshold therefore decides rest for the whole state. A comparison of raw velocity against a position threshold would misjudge rest in both directions. Stiff springs would tick long after their motion stopped being visible. Soft springs would rest while they still had enough velocity to move visibly.

The same threshold drives `timeRemaining` and the duration-based configs, so all three share one definition of rest. `timeRemaining` reports 0 exactly when the spring is resting. A duration-tuned config is tuned against its own threshold, so changing `precision` keeps its timing (see "Rest time is solved" for how close that timing is).

The rest amplitude bounds how far the spring can still travel. Friction only takes energy out of the motion, so no later displacement `abs(x)` exceeds the current rest amplitude, at any `dampingRatio`. A spring that rests never cuts off motion that would have left the threshold. The rest amplitude itself does not shrink steadily. Before it decays, it can rise above its current value by a factor of up to `sqrt(2)`, which it approaches as `dampingRatio` nears 0. The worst case is about 1.38 at a `dampingRatio` of 0.1, 1.25 at 0.7, and 1.21 at 1. That rise is why a spring can rest a little before its solved rest time (see "Rest time is solved"). A spring with no friction (`dampingRatio` 0) never rests unless it starts inside the threshold, because no friction means the motion never decays. The exception is an `arrival` multiplier that stops or slows the spring at the target.

## Rest time is solved

`timeRemaining` and the duration-based config shapes share the rest predicate's threshold. Coily solves both from the way the motion decays and does not estimate them. Two closed-form bounds on the rest amplitude, `abs(x) + abs(v) / wn`, cover every kind of spring.

The first holds in every regime. It bounds the closed forms term by term:

```
exp(-sigma*t) * (a*g(t) + b*h(t))
a = abs(x0) + abs(v0) / wn
b = abs(v0 + sigma*x0) + abs(zeta*v0 + wn*x0)
```

Here `x0` and `v0` are the state at the start, `zeta` is the `dampingRatio`, and `sigma` is the decay rate, `zeta * wn`. `wd` is `wn * sqrt(abs(1 - zeta^2))`: for a bouncy spring, the frequency at which it actually oscillates. For a spring that does not bounce (overdamped), `g = cosh(wd*t)` and `h = sinh(wd*t) / wd`. At critical damping, `g = 1` and `h = t`. For a bouncy (underdamped) spring, `g = 1` and `h = min(t, 1/wd)`. From rest, the bound is exact at and above critical damping. It changes continuously as `dampingRatio` passes 1, so duration tuning does too.

The second is the oscillation envelope of a bouncy spring. Its trajectory is `exp(-sigma*t) * R * f(t)`, where `R` is the exact oscillation amplitude. `f` pulses periodically between `sqrt(1 - zeta^2)` and `sqrt(2 + 2*zeta)`. Both limits are exact, so the envelope touches the rest amplitude at the peak of each pulse. A bouncy spring takes whichever bound enters the threshold first. The envelope usually decides. Near critical damping, `R` grows without limit as the oscillation slows, and the first bound decides.

Coily solves for the time at which the bound enters the threshold. The envelope has a simple inverse, which coily solves algebraically. The first bound does not, so coily bisects it to machine precision.

Three kinds of slack remain. All are one-sided, and all are bounded:

- Coily checks rest once per tick, so a spring rests no later than the first tick at or after the solved time: never more than a frame late. The next two kinds make it rest earlier.
- A bouncy spring's rest amplitude pulses below its envelope. A frame that lands on a low point of the pulse inside the threshold rests early. Where the envelope decides, a spring can rest up to `ln(max(f) / min(f)) / sigma` before the solved time, which is `ln(2 / (1 - zeta)) / (2 * sigma)`. That is under one oscillation for a `zeta` above about 0.06, and it grows to several oscillations as `zeta` nears 0. Measured on a 1 ms grid at the default precision, `duration: 500` from displacement 1 rests at 403 ms with `bounce` 0.1 (19% early), 429 ms with 0.3 (14%), and 448 ms with 0.5 (10%). With `displacement: 300` it rests between 465 ms and 499 ms for the same bounces. The motion that an early rest cuts off still never leaves the threshold.
- From a moving state, a spring that does not bounce can report more time than it needs. The first bound adds the absolute values of terms that partly cancel in the real motion. A flung spring, or one retargeted mid-flight, can therefore rest well before its `timeRemaining`, and still never more than a frame after it.

The contract is: never later, within a frame, and possibly earlier, by at most the slack above. A duration-tuned config inverts the same bounds from rest with its own threshold. A non-bouncy config rests at its `duration` on the tick grid at any `precision`: `duration: 750` rests at 750 ms, not comfortably before it. So does a bouncy config close enough to critical damping that the first bound decides: in testing, a `dampingRatio` of 0.9999 or closer rested at its `duration`, and 0.99 did not. Any other bouncy config rests by the first tick at or after its `duration`, and possibly earlier by the slack above. `arrival` fits into the solution exactly. A multiplier of 0 caps the time at the first target crossing (see "Arrival is exact"). A rebound or a slowdown loses velocity at each crossing, and coily adds that loss to the envelope's decay rate as `ln(1 / abs(arrival)) * wd / pi`. This is also why a spring with no friction and such a multiplier reports a finite time and rests on it.

## Rest is a fixpoint

When a tick lands inside the resting threshold, coily sets the displacement and velocity to exactly zero before it emits the final `update`. Anything that reads the spring during or after that update sees the target itself, not a tiny leftover. This makes rule 1 safe end to end:

- At rest, `value === target` holds bit for bit, even for targets like `77.7731` that float arithmetic would not land on by itself.
- A follower's final retarget sees its leader's target exactly, so chains of springs settle on exact values and do not inherit leftovers.
- A resting spring retargeted away and then back returns to its old value exactly. The two retargets can leave a remainder of about an ulp. At ordinary UI sizes that remainder falls inside the threshold, so the second retarget rests the spring at once, exactly on its target. Rest is the anchor that keeps repeated retargets free of drift.

## Arrival is exact

An `arrival` multiplier other than 1 (`'passthrough'`) turns each target crossing into an event. Crossings follow rule 1: coily solves them and does not sample them. Each solver knows the exact formula for its motion. Whenever it anchors, it also solves `x(t) = 0` for the first crossing strictly in the future:

- Underdamped: the first `t > 0` with `wd*t = atan(-c1/c2)`, plus pi when that is not positive. This crossing always exists. The textbook `atan2(-c1, c2) (mod pi)` loses a crossing that is a hair away: `atan2` rounds the angle to exactly `-pi`, and the reduction then moves the crossing a whole half period later.
- Critically damped: `t = -c1/c2`, when it is positive. That happens when the momentum is strong enough to carry the spring through the target.
- Overdamped: `wd*t = atanh(-c2/c1)`, when it is positive.

`c1` and `c2` are the constants that the solver computes from the anchor. The solvers and `timeRemaining` share one implementation of these roots. A tick that reaches the crossing splits there. The solver evaluates the motion at the crossing time and writes the position as an exact 0. The crossing is defined by `x = 0`, so the solver discards the small error of the evaluation. It then multiplies the velocity by the multiplier, anchors again, and spends the rest of the step from the new anchor. The crossing time is a solved root, not a sampled change of sign, so no step size can miss it. A lag spike that jumps over a whole sequence of bounces still lands every crossing in it, in order.

For `arrival: 'stop'` (multiplier 0), this makes arrival a second exact fixpoint, next to rest. The spring's final update reads `value === target` bit for bit, at the first crossing. No step size renders an overshoot. This includes a spring with no friction, which can rest only through an `arrival` multiplier with an absolute value below 1. `timeRemaining` reports the solved time of that crossing whenever it comes before the solved rest time.

A rebound (a negative multiplier) anchors again at every crossing. A long sequence of bounces therefore stays exact piece by piece: error does not build up across crossings, just as it does not build up across frames. A rebounding spring never goes past its target. It rests exactly on the target itself, set there per rule 2.

## Followed targets

Everything above concerns a spring and its own target. Following adds an approximation that an _isolated_ spring, one that follows nothing and that nothing follows, never has. A follower's target moves continuously with its leader, but the follower can only read it at discrete points. That sampling is where frame timing leaks into trajectories. Two mechanisms keep the leak small.

### First-order hold

A _passthrough edge_ is a follower outside any follow cycle, with the default `arrival`. On a passthrough edge, each step does not hold the leader's value from the start of the step. It follows a straight line through the leader's actual motion over the step, which is called a first-order hold. The exact formulas still apply. A target that moves at a constant slope `g` shifts the spring's resting point by the constant `-(damping/tension) * g`. The solver ticks the shifted state exactly and then shifts back. A follower tracks a leader that moves in a straight line to rounding, at any step size. A leader that curves leaves an error that shrinks with the square of the step.

### Error-controlled sub-steps

Before each frame, the system estimates the error that each follow edge is about to pick up. The estimate uses the edge's recent frame deltas and its leader's current state. When one step would exceed the edge's error budget, the system splits the frame into up to 8 equal sub-steps. The budget is `max(0.5 * 10^-precision, couplingTolerance)`: the follower's own resting threshold, with the system-wide `couplingTolerance` (default 0.1) as a floor. A quiet frame takes one step and costs nothing extra. Teleports, flings, and dropped frames get sub-steps. The estimate is a calibrated heuristic, not a proven bound. The budget targets the error within one frame. Over a long trajectory those errors add up, and the measurements under "What following preserves" show their size in two tested cases.

A slope never applies inside a cycle. Around a loop, the velocity part of a slope is always one step out of date. That can destabilize a cycle that held targets keep stable. A slope also never applies to a spring with an `arrival`, whose crossings have exact solutions only against a held target. Those edges hold the target constant for each sub-step instead.

### Following a ramp

A ramp (`createRamp`) moves at an exactly constant speed. Its change over any sub-step is `rate * h`, where `h` is the sub-step length, so the first-order hold follows it exactly. A spring with the default `arrival` that follows a ramp matches the continuous motion to rounding, at any frame rate. Following a ramp at 100 units per second for 1 s, with tension 170 and damping 26, reads the same value at 30, 60, 120, and 240 fps to within 3e-13 (measured in Node 26). Two cases leave error, and the sub-step controller budgets for it. A curved map of a ramp, such as `mapSpring(clock, (ms) => Math.sin(ms / 100))`, leaves the same curvature error as any curving leader. A bounded ramp's arrival is a sharp corner inside a frame, which the recent history cannot predict. The ramp knows its arrival time, so that frame takes the full 8 sub-steps. The error that remains comes from an arrival between sub-step boundaries.

### What following preserves

- An isolated spring never takes sub-steps. K steps of `dt/K` do not give the same float result as one step of `dt`. An isolated spring therefore advances in one step per frame, split only at its own arrival crossings.
- Synchronous writes stay events. A retarget, a value write, or a `jumpTo` on a leader reaches its followers as an exact step at the time of the write. It is never spread across the next frame.
- Rest is a fixpoint through any depth of following, and coily still solves arrival crossings and never samples them.

Frame rate still changes a chain's shape, by an amount the sub-step controller holds near the error budget. Measured in Node 26 at the default precision, the tail of a three-spring chain (tension 170, damping 26, default `couplingTolerance`) whose head is retargeted from 0 to 100 reads within 0.005 of the same value at 300 ms across 30, 60, 120, and 240 fps.

A cycle depends on the frame rate more, because its closing edge holds its target one frame behind. Two springs with that config, following each other from 0 and 100, settle at 50.64 at 30 fps, 50.29 at 60, 50.14 at 120, and 50.09 at 240. Shorter frames bring the shared value closer to 50, and each frame rate settles on its own.

## What stays exact

Two comparisons look like they need a tolerance, but they use exact equality on purpose:

- A retarget compares the new target with the current one exactly, and does nothing only when they are equal. A target is a value that the user supplies, not a computed one. Coily honors a request for a value one ulp away and does not absorb it.
- The choice of solver on `dampingRatio === 1` picks between exact formulas and makes no claim about the motion. Both neighboring solvers stay stable as the damping ratio approaches 1. A ratio near 1 takes whichever branch it lands in and produces the near-critical trajectory either way. Duration tuning and `timeRemaining` change continuously across the branch.

## Working with the model

`precision` is an absolute resolution. The default assumes values of ordinary UI size, such as pixels, percentages, or degrees. If your values are smaller, raise it. An animation of a scale factor from 1 to 1.005 sits entirely inside the default threshold. It rests and snaps at once, which looks like a teleport. If your values are huge, a lower `precision` ends motion sooner. A duration-tuned config is the exception. It retunes its stiffness against its own threshold, so it keeps its `duration` at any `precision`, as "Rest time is solved" defines it. A higher precision makes it stiffer, so it covers the extra decimal places in the same time. A displacement below the threshold rests at once by design. Differences smaller than the configured resolution do not count as motion.

`defineSpring` throws for inputs whose derived mass, tension, natural frequency, or resting threshold is not finite and positive, including finite inputs that overflow or underflow. Among accepted inputs, the tests cover damping ratios from the smallest positive float to 1e8. At 1e8 a spring still moves and reports a finite `timeRemaining`.

For numerical tests, dyadic values such as integers, halves, and quarters never round, so they suit exactness assertions. Non-dyadic values such as `0.1` and `77.7731` exercise real rounding. Exact-equality assertions make the best regression guards. A settled spring lands `toBe` its target, and, at ordinary UI sizes, a retarget round trip from rest restores `toBe` the prior value.
