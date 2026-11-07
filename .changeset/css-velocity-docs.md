---
'coily': patch
---

Correct two `coily/css` docs. `springToTransition` accepts a spec with a
`velocity`, and the transition then starts at that speed. This hands off a
moving value, such as a drag at release, and the velocity reshapes both the
curve and the duration. The `displacement` option changes more than the
duration. A larger move takes longer to come within the rest threshold, so
the `linear()` stops land at different percentages.
