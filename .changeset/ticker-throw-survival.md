---
'coily': patch
---

A listener that throws during a frame no longer kills the animation loop.
The error still surfaces from the frame callback, so you see it, and the
loop keeps stepping the other springs instead of stopping dead at the
first exception. A listener that calls `stop()` mid-frame now stops
cleanly, with no stray frame scheduled behind it. Manual `advance()` loops
are unchanged: the exception reaches the caller, and your next `advance()`
picks up where the pass left off.
