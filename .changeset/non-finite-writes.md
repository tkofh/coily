---
'coily': patch
---

A `NaN` or infinity used to slip in and corrupt the simulation with no
warning: one bad number, and every value it touched read `NaN` from then
on. Now the bad value throws where you introduce it: assigning it to
`target`, `value`, or `velocity`, or passing it to `jumpTo`,
`createSpring`, `advance`, or a composite write. A composite write names
the offending channel in the error. `defineSpring` rejects non-finite
options the same way, and a followed source that produces a non-finite
value throws as the follower retargets, surfacing from `advance` or your
frame callback.
