---
'coily': patch
---

Fix springs producing incorrect motion when damping is changed mid-animation across regime boundaries (e.g., underdamped to overdamped). Fix ticker lag compensation being disabled after setting `lagThreshold` or `adjustedLag` at runtime.
