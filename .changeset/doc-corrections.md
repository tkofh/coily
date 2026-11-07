---
'coily': patch
---

Correct three docs.

- `arrival` acts only when the value crosses the target. A spring with a
  `dampingRatio` of 1 or above that is retargeted from rest never crosses,
  so its `arrival` changes nothing.
- `springToTransition` accepts a spec with a `velocity`, and the transition
  starts at that speed. This hands off a moving value, such as a drag at
  release. The velocity reshapes both the curve and the duration.
- The `coily/css` `displacement` option changes more than the duration. A
  larger move takes longer to come within the rest threshold, so the
  `linear()` stops land at different percentages.
