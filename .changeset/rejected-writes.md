---
'coily': patch
---

Fix writes that threw after changing part of a spring. A write that throws
now changes nothing.

- A write to a disposed `Spring` or `CompositeSpring` throws
  `Cannot write to a disposed spring`. Before, a `velocity` or `config`
  write did not throw, and any write put the spring back in its system.
  Every later `advance` then threw `Cannot tick a disposed motion`, and no
  other spring in the system moved.
- A rejected `target` write keeps the current follow. Writing `NaN` or
  `Infinity` to a following spring, or following a source whose value is
  not finite, threw after the spring had stopped following its source.
- A composite `target`, `value`, `velocity`, or `config` write, or a
  `jumpTo` call, checks its whole input first. One that named an unknown
  channel or held a bad entry threw after changing the channels listed
  before it, and those channels emitted events. A composite `target`
  naming a leader of another shape left some channels following it. A
  channel target that is a source with a non-finite value now throws with
  the channel's path.
