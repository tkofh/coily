---
'coily': patch
---

Fix `timeRemaining` on `useSpring` refs going stale. A retarget from rest
emits no update until the next frame, so an effect reading
`timeRemaining` kept seeing 0 while the spring had started to move. The
ref now also triggers when the spring starts and stops.
