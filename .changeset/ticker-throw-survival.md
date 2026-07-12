---
'coily': patch
---

A listener that throws during a frame no longer kills the animation
loop. The ticker schedules the next frame in a `finally`, so the
exception still surfaces from the frame callback while stepping
continues, and a listener that calls `stop()` mid-step no longer leaves
a stray frame scheduled. Manual `advance()` loops are unchanged:
exceptions propagate to the caller, and the next call picks up where
the pass aborted.
