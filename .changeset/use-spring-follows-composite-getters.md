---
'coily': patch
---

Fix `useSpring` with a getter or ref that returns a composite leader.
`useSpring(() => (pick.value ? left : right))` threw when `left` and
`right` were object `useSpring` refs. It now follows the current leader
channel by channel, and it switches leaders when the getter changes. A
getter can also switch between a leader and a plain shape. A pooled
`CompositeSpring` can be a leader too, directly or from a getter or ref.

A shape-valued source that is not a composite, such as
`velocityOf(composite)`, now throws a clear error instead of following
nothing.
