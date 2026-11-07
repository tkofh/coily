---
'coily': patch
---

Fix heavily overdamped springs snapping to rest early. The overdamped
solver froze part of its formula to avoid an overflow, and for a large
`dampingRatio` that cut the motion short. A `dampingRatio: 10` spring
jumped the last 22% of its move to the target, and
`defineSpring({ duration: 500, dampingRatio: 10 })` rested after as little
as 71 ms. The solver now follows the exact curve to rest, so these springs
rest at the time `timeRemaining` and `duration` state.

This changes how heavily overdamped springs move. A spring tuned with a
large `dampingRatio` now eases in over its full rest time instead of
snapping, so it can take noticeably longer to settle. Springs with a
`dampingRatio` below about 3 move as before.
