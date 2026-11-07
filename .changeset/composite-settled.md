---
'coily': patch
---

Fix `CompositeSpring.settled` hanging in one case. You read `settled`
during a tick, for example in another spring's update listener, and the
composite came back to rest before that tick ended. The composite then
fired neither `start` nor `stop`, so the promise waited for some later
motion. It now resolves at the end of the tick.
