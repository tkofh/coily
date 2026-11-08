---
'coily': minor
---

A throwing listener no longer strands other listeners or a motion's
lifecycle.

- Every listener for an event runs, and every motion in a frame delivers
  its events, even after one throws. `advance` then rethrows the error, or
  an `AggregateError` of all of them, whose message leads with the first
  error's.
- A spring, ramp, or composite whose last `update` listener throws still
  emits `stop` and resolves `settled`. Before, it could rest with
  `settled` pending forever.
- A follower that its leader wakes during a frame emits `start` after the
  frame's motion, with the other events. Before, `start` fired mid-frame,
  where a listener that disposed the follower made `advance` throw.
- Calling `advance` from a `mapSpring` callback or a `SpringSource` getter
  throws. Listeners can still call it.
