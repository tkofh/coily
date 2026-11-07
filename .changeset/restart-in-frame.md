---
'coily': patch
---

Fix `stop()` followed by `start()` inside a listener during a frame. The
system scheduled a second frame loop, so every listener then ran twice per
frame until the next `stop()`. The system now keeps a single loop.
