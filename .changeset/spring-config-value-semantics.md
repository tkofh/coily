---
'coily': patch
---

Fix a config aliasing bug and make `SpringConfig` a true immutable value.

Previously, assigning `spring.config` on a spring that was sharing a config
instance mutated that shared instance in place. In the worst case — a spring
created without a config — this mutated the global default, silently retuning
every other default-config spring in the app.

`SpringConfig` instances are now frozen and never mutated. Springs track an
explicit config override plus a resolved effective config, and config changes
propagate to inheriting followers through an internal follower registry
instead of shared mutable references. The internal `assign()` method and
`_version` counter are gone, along with the per-tick version polling in the
motion loop.

Behavioral notes:

- Springs constructed with the same `SpringConfig` instance are no longer
  coupled: reassigning one spring's config never affects another spring.
- Disposing a leader now cleanly detaches its followers; they keep their
  current config and target and can be retargeted normally.
- Config changes still propagate live through chains of inheriting followers,
  including transitively.
