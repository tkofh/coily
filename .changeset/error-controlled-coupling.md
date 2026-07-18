---
'coily': minor
---

Following is now accurate at any frame rate. Within a frame, a follower
integrates against the path its leader actually traveled — a linear
ramp through the leader's real motion, which the closed-form solvers
handle exactly — instead of a value sampled once at the frame boundary.
And when a single frame carries more motion than the coupling tolerance
allows (a dropped frame, a teleported target), the system splits that
frame into up to 8 internal sub-steps. Quiet frames take one step and
cost what they always did; update events still fire once per spring per
frame.

Two long-standing frame-rate artifacts in follow cycles are fixed: a
mutual-follow pair released from displacement now settles at its true
midpoint instead of drifting below it on slow frames, and a self-follow
fling travels the same distance at 30fps as at 60fps.

New: `couplingTolerance` — a `createSpringSystem` option, a live
`SpringSystem` property, and a nuxt module option — sets how far a
follower may trail its source within one frame, in the value's own
units. The default is 0.1; smaller is tighter and spends more solver
work; it never goes finer than the follower's resting precision.

Follower trajectories change with this release: they sit closer to the
continuous ideal everywhere, most visibly in deep chains on slow
frames. Springs that follow nothing are bit-for-bit unchanged, and
synchronous writes (`target`, `value`, `jumpTo`) still land exactly at
write time.
