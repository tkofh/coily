# Precision

How coily handles floating-point arithmetic: what it computes exactly,
what it compares tolerantly, and what `precision` actually controls. This
is the reference for the library's numerical contract. If a behavior
contradicts this document, one of the two is a bug.

## The model

Two rules apply everywhere:

1. **State and reads are exact IEEE 754.** Solvers evaluate their
   closed-form solutions from exact anchors, retargeting rebases the exact
   displacement, followers chase the exact leader value, and `value` and
   `velocity` return exactly what the arithmetic produced. No operation
   rounds, snaps, or otherwise post-processes its result.
2. **The one discrete decision — rest — is tolerance-aware.** A spring
   rests when its remaining motion falls inside a threshold set by
   `precision`, and resting state is snapped exactly to the target.

Rule 1 holds because every operation is exactly rounded: a chain of
arithmetic returns the exact trajectory of a spring displaced a few ulps
away, and no consumer can distinguish that from microscopically different
motion. Rounding reads would add nothing — a browser paints
`96.86000000000001px` and `96.86px` identically — while feeding rounded
values back into state (rebasing a retarget, anchoring a solver) injects
up to half the rounding quantum per write and drifts the value under
per-pointermove retargeting.

Rule 2 exists because "has this spring stopped?" is a discrete question
about a value that exponential decay drives toward zero but never lands
on. Without a threshold, springs would tick forever; with a raw
comparison, the answer would flap on sub-perceptual residue. The
threshold is the single place coily is deliberately approximate.

## The rest predicate

A spring rests when the decay envelope's effective amplitude is inside
the resting threshold:

```
|x| + |v| / ωₙ  ≤  0.5 × 10⁻ᵖ
```

where `x` is displacement from the target, `v` is velocity, `ωₙ` is the
natural frequency, and `p` is the configured `precision` (default 2, so
the default threshold is 0.005).

The two terms are both measured in position units. Velocity is worth
`v / ωₙ` of future travel — kinetic energy converts to displacement at
the scale the spring's own stiffness sets — so one threshold decides rest
for the whole state. Comparing raw velocity against a position threshold
would misjudge rest in both directions: stiff springs would tick long
after their motion stopped being resolvable, and soft springs would be
declared resting while still carrying enough velocity to move visibly.

The same threshold drives `timeRemaining` and duration-based
configuration, so all three agree about when motion ends: `timeRemaining`
reports 0 exactly when the spring is resting, and a duration-tuned config
rests on the schedule it advertised (see "Rest time is solved").

The envelope is an estimate of the amplitude the trajectory can still
reach, not a strict bound. For underdamped springs the true peak can
exceed it by a bounded factor (about 1.4× at worst, near ζ ≈ 0.7), which
stays at sub-threshold scale. An undamped spring (ζ = 0) never rests
unless created inside the threshold, which is what zero damping means —
unless an `arrival` multiplier stops or slows it at the target.

## Rest time is solved

`timeRemaining` and the duration-based config shapes share the rest
predicate's threshold, and both are solved from the motion's decay bound
rather than estimated. Each regime has a closed-form bound on the rest
amplitude `|x| + |v| / wn`: an underdamped trajectory is
`exp(-sigma*t) * R * f(t)` with `R` the exact oscillation amplitude and
`f` pulsing periodically up to `sqrt(2 + 2*zeta)` — a strict maximum,
unlike the rest predicate's envelope — while the non-oscillating regimes
decay under the sum of their two modes. The time that bound enters the
threshold is solved algebraically where the inverse is elementary and by
bisection to machine precision where it is not (critical damping's
`t * exp(-t)` term).

Two slacks remain, both one-sided and both bounded:

- Rest is sampled per tick, so it lands at the first tick at or after
  the solved time — within one frame, never later.
- An underdamped spring's rest amplitude pulses under its envelope, so a
  frame that samples a dip inside the threshold rests early — up to
  `ln(max(f) / min(f)) / sigma` before the solved time, a few percent of
  the total for ordinary configs.

The contract reads: never later (within a frame), possibly earlier
(within a pulse). A duration-tuned config inverts the same bound, so
`duration: 750` rests at 750ms on the tick grid rather than comfortably
inside it. `arrival` folds in exactly: 0 caps the time at the first
target crossing (see "Arrival is exact"), and a rebound or slowdown adds
its per-crossing velocity loss, `ln(1 / |arrival|) * wd / pi`, to the
effective decay rate — which is also why an undamped spring with such a
multiplier reports a finite time and honors it.

## Rest is a fixpoint

When a tick lands inside the resting threshold, the state is zeroed —
exactly — before the final `update` is emitted. Anything reading the
spring during or after that update sees the target itself, not
sub-threshold residue. This is what makes rule 1 safe end to end:

- `value === target` at rest, bit-for-bit, even for targets like
  `77.7731` that no float arithmetic would land on by itself.
- A follower's final rebase sees its leader's target precisely, so chains
  of springs settle on exact values instead of inheriting residue.
- Retargeting away and back restores the value exactly: rest is the
  anchor that keeps repeated rebasing drift-free.

## Arrival is exact

An `arrival` multiplier other than 1 (`'passthrough'`) makes target
crossings events, and they follow rule 1: solved, not sampled. Each
solver knows its closed form, so whenever it anchors it also solves
`x(t) = 0` for the first strictly future crossing:

- underdamped: the first `t > 0` with `wd*t = atan2(-c1, c2) (mod pi)`,
  which always exists
- critically damped: `t = -c1/c2`, when positive — momentum strong
  enough to punch through
- overdamped: `wd*t = atanh(-c2/c1)`, when positive

A tick that reaches the crossing splits there. The solver evaluates at
the crossing time, writes the position as an exact 0 — the crossing is
defined by `x = 0`, so the evaluation residue is discarded — scales the
velocity by the multiplier, re-anchors, and spends the remainder of the
step from the new anchor. Because the crossing time is a root rather
than a sampled sign change, no step size can miss it: a lag spike that
jumps a whole bounce sequence still lands every crossing in it, in
order.

For `arrival: 'stop'` (multiplier 0) this makes arrival a second exact
fixpoint alongside rest. The spring's final update reads
`value === target` bit-for-bit, at the first crossing, with no rendered
overshoot at any step size — including for an undamped spring, which a
stop is the only way to rest. `timeRemaining` reports the exact time of
that crossing whenever it is nearer than the solved rest time.

Rebounds (negative multipliers) re-anchor at every crossing, so a long
bounce sequence stays piecewise closed-form: error never accumulates
across crossings any more than it does across frames. A rebounding
spring never visits the far side of its target, and it rests — snapped,
per rule 2 — exactly on the target itself.

## What stays exact

Two comparisons look like they want a tolerance but deliberately use raw
equality:

- **Retarget no-op guards** (`value !== target`) compare exactly. A
  target is a user-provided identity, not a computed quantity — asking
  for a value an ulp away is honored, not absorbed.
- **Solver dispatch** on `dampingRatio === 1` routes between closed
  forms and makes no semantic claim. Both neighboring solvers evaluate
  stably as ζ approaches 1, so a near-critical ratio takes whichever
  branch it lands in and produces the near-critical trajectory either
  way.

## Working with the model

`precision` is an absolute resolution, and the default assumes values of
ordinary UI magnitude — pixels, percentages, degrees. When your domain is
smaller, raise it: animating a scale factor from 1 to 1.005 sits entirely
inside the default threshold and will rest (and snap) immediately, which
reads as a teleport. When your domain is huge, lowering it ends motion
sooner. Displacements below the threshold resting instantly is the
contract working as designed — differences smaller than the configured
resolution are not meaningful motion.

For numerical tests: dyadic values (integers, halves, quarters) never
round and are ideal for exactness assertions; non-dyadic values (`0.1`,
`77.7731`) exercise real rounding behavior. The regression guards worth
keeping are exact-equality assertions — a settled spring lands `toBe` its
target, and a retarget round trip restores `toBe` the prior value.
