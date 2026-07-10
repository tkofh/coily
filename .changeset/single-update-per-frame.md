---
'coily': patch
---

Springs now emit exactly one `update` per frame.

Previously, retargeting called an emitting zero-length tick, so a follower
emitted twice per frame — and in chains the emissions cascaded: each spring's
update retargeted the next, whose emission retargeted the one after, making
per-frame emitter traffic quadratic in chain length. Retargets now re-baseline
silently (a retarget never changes the spring's current value), so `update`
means "a tick recomputed the value" and fires once per motion per frame.
Chain benchmarks improve 4-8x (`settle 256-spring chain` +711%).

Also fixed in the same pass:

- Setting `spring.target` no longer emits a synchronous `update` — the next
  real tick reports it. `start`/`stop` still fire synchronously on transitions.
- A follower that settled and was re-woken by its leader within the same tick
  pass no longer advances (and emits) twice in that frame; each motion now
  ticks at most once per pass.
