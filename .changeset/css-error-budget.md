---
'coily': minor
---

`coily/css` easings meet their `maxError`, and the returned `maxError`
reports the error of the string as written.

- The budget now covers rounding of stop values and percentages and the
  curve between samples. Tight budgets add stops and decimal places, and
  very short durations keep their shape: a 0.1 ms spring returned
  `linear(0, 1)` before. Most easings gain a few stops.
- A settling easing follows the spring to `duration`, then steps onto the
  target at 100%, where a live spring snaps.
- `maxError` must be greater than 0, `maxDuration` finite and greater than
  0, and `displacement` finite and nonzero. Each throws otherwise.
