---
'coily': patch
---

Reject `bounce: 1` in configs that set `damping` without `duration`.
`defineSpring({ damping, bounce })` and
`defineSpring({ tension, damping, bounce })` derive tension or mass from
the damping, and at `bounce` 1 that result blows up.
`defineSpring({ damping: 10, bounce: 1 })` derived a tension of 2.5e9.
These shapes now throw for `bounce` 1, as their docs already said.
Every other shape still accepts `bounce: 1`.
