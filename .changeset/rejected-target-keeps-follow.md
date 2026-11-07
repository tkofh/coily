---
'coily': patch
---

Fix a rejected `target` write ending a follow. Writing `NaN` or `Infinity`
to a following spring threw, but the spring had already stopped following
its source. Following a source whose current value is not finite did the
same. Both writes now throw before they change anything.
