---
'coily': patch
---

Fix duration configs ignoring `precision`. A `duration` config was always
tuned against the default resting threshold of 0.005, so a config that set
another `precision` rested at the wrong time.
`defineSpring({ duration: 500, dampingRatio: 1, precision })` rested at
153 ms with precision 0 and at 811 ms with precision 4. A duration config
is now tuned against its own threshold, so it rests at its `duration` at
any `precision`.

This changes the physics of every duration config that sets a
non-default `precision`. A higher precision now makes the spring stiffer,
so it settles the extra decimal places in the same time. A lower precision
makes it softer. Configs at the default precision move as before.

The `displacement` limit now follows `precision` too. Its magnitude must be
greater than the resting threshold, `0.5 * 10^-precision`, and the error
message says so.
