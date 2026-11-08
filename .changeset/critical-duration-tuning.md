---
'coily': minor
---

Duration configs near a `dampingRatio` of 1 rest at their `duration`. On
either side of 1, the tuning used a bound that loosened without limit, so
`{ duration: 500, dampingRatio: 1 + Number.EPSILON }` rested at 173 ms and
`0.9999` at 398 ms. Tuning and `timeRemaining` now use one bound that is
exact from rest at and above critical damping and continuous through 1.
Configs in that range move more softly than before. For overdamped springs,
`timeRemaining` reads closer to the actual rest time.
