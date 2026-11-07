---
'coily': patch
---

Fix a rejected `target` write ending a follow. Writing `NaN` or `Infinity`
to a following spring threw, but the spring had already stopped following
its source. The write now throws before it changes anything.
