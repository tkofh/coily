---
'coily': patch
---

Assigning a config whose resting threshold already contains a spring's
remaining motion ends the motion at once, as `jumpTo` does: the value snaps
to the target and `update` and `stop` fire. Before, `isResting` and
`settled` reported rest while the value still differed from the target.
