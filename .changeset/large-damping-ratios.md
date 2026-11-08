---
'coily': patch
---

A spring with a very large damping ratio keeps creeping toward its target.
Near a ratio of 1e8, its slow decay rate rounded to 0, which froze the
spring and made `timeRemaining` `Infinity`. Ratios from about 1e4 up also
gain accuracy.
