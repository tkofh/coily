---
'coily': patch
---

`lagThreshold` and `adjustedLag` now read back the values you set. Before,
`lagThreshold = 0` read back as `100000000`, and a gap longer than that still
counted as lag. Setting `lagThreshold` below `adjustedLag` also lowered
`adjustedLag` for good, so setting `lagThreshold` to 10 and then 500 left
`adjustedLag` at 10. Now 0 disables lag clamping for every gap, and a frame
caps `adjustedLag` at `lagThreshold` only when it applies it.
