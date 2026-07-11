---
'coily': patch
---

Retargeting no longer feeds precision rounding back into spring state.
Rebasing on retarget, solver re-anchoring after position/velocity/config
writes, and follower target chasing all read the exact position now, so a
retarget preserves the spring's value instead of perturbing it by up to
half the precision quantum. Under per-pointermove retargeting (dragging)
the old rebase jittered the value by ±0.005 on the default precision,
forcing style damage at input rate; retarget round trips are now exact.

Rest is also a fixpoint now: when a tick lands inside the resting
threshold, the exact state is zeroed before the final update, so a
follower's last rebase sees its leader's target precisely.
