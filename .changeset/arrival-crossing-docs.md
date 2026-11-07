---
'coily': patch
---

Document that `arrival` acts only when the value crosses the target. A
spring with a `dampingRatio` of 1 or above that is retargeted from rest
never crosses, so its `arrival` changes nothing.
