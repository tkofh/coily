---
'coily': patch
---

Non-finite numbers throw instead of silently poisoning the simulation.
`NaN` or an infinity assigned to a spring's `target`, `value`, or
`velocity` — or passed to `jumpTo`, `createSpring`, `advance`, or a
composite write, which throw with the channel's path — now raises
immediately, and `defineSpring` rejects non-finite options (infinities
previously slipped past its range checks). A followed source that
produces a non-finite value throws at the retarget, surfacing from
`advance` or the frame callback.
