---
'coily': minor
---

Composite spring targets mix numbers and sources per channel: each
channel of a partial target now takes a number to animate toward or a
scalar `SpringSource` to follow —
`follower.target = { x: 5, y: mapSpring(lead, ({ x }) => -x) }`.
Partial semantics are unchanged: unnamed channels are left alone, and
naming a channel detaches it from a followed leader. The new
`TargetShape` type names the accepted shape; `value`, `velocity`, and
`jumpTo` writes stay numeric.
