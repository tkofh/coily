---
'coily': minor
---

`Spring.timeRemaining` and `SpringDefinition.computeTimeRemaining` are
now solved, not estimated. The old value followed the decay envelope
with a 2x safety margin and over-reported by roughly that factor; the
new value is the exact time the motion's decay bound enters the resting
threshold. The spring is resting at the first tick at or after it, and
a bouncy spring can rest at most one oscillation earlier when a frame
samples a low pulse. Expect reported times roughly half of what they
were.

`arrival` folds in exactly: a multiplier of 0 caps the time at the
first target crossing (as before), and rebounds or slowdowns now add
their per-crossing velocity loss to the effective decay rate — an
undamped spring with such a multiplier reports a finite time instead of
Infinity, and honors it.

The time is solved from the live state on read, and nothing is
maintained per tick: springs whose `timeRemaining` is never read pay
nothing for it, however often they move.
