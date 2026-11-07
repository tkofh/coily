---
'coily': patch
---

Fix writes to a disposed spring. Every write to a disposed `Spring` or
`CompositeSpring` now throws `Cannot write to a disposed spring` before it
changes anything. Before, a `velocity` or `config` write did not throw, and
any write put the spring back in its system. Every later `advance` then
threw `Cannot tick a disposed motion`, and no other spring in the system
moved.
