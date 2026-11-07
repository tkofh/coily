---
'coily': minor
---

Fix two cases where a spring rested at a different time than its config
promised. Both change how the affected springs move.

- Heavily overdamped springs no longer snap to rest early. The solver froze
  part of its formula to avoid an overflow, and at a large `dampingRatio`
  that cut the motion short. A `dampingRatio: 10` spring jumped the last
  22% of its move, and `defineSpring({ duration: 500, dampingRatio: 10 })`
  rested after as little as 71 ms. These springs now follow the exact curve
  and rest when `timeRemaining` and `duration` say, so they can take
  noticeably longer to settle. Springs with a `dampingRatio` below about 3
  move as before.
- Duration configs now tune against their own `precision`. They always used
  the default resting threshold of 0.005, so
  `defineSpring({ duration: 500, dampingRatio: 1, precision })` rested at
  153 ms with precision 0 and at 811 ms with precision 4. It now rests at
  500 ms at any precision. A higher precision makes the spring stiffer, and
  a lower one makes it softer. Configs at the default precision move as
  before. The `defineSpring` `displacement` limit follows `precision` too:
  its magnitude must be greater than `0.5 * 10^-precision`.
