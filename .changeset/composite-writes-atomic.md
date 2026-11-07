---
'coily': patch
---

Fix rejected composite writes changing part of the spring. A `target`,
`value`, `velocity`, or `config` write, or a `jumpTo` call, that named an
unknown channel or held a bad entry threw. The channels listed before the
bad entry had already changed and emitted events. A composite `target`
naming a leader of another shape left some channels following it. Every
composite write now checks the whole input first, so a write that throws
changes nothing.

A composite channel target that is a source with a non-finite value now
throws with the channel's path.
