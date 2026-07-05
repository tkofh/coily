---
"coily": minor
---

`onStart` and `onStop` now describe the spring's logical animation state and
alternate strictly: `start` fires only on the resting → moving transition, and
`stop` only on moving → resting.

Previously, `start` fired on every retarget while a spring was already moving
(so a follower emitted it every frame), never fired for `velocity` kicks, and
`jumpTo` on an already-resting spring emitted a spurious `stop`.

- Retargeting a moving spring no longer re-fires `start`; it fires again only
  after the spring has come to rest.
- Setting `velocity` on a resting spring now fires `start`.
- `jumpTo` fires `stop` only when it actually interrupts motion.
- `Spring2D` fires `start` once per fully-resting → moving transition instead
  of once per axis, mirroring how `stop` already waited for both axes.
