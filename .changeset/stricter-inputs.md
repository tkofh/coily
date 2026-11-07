---
'coily': minor
---

Two inputs that used to misbehave quietly now throw.

- `system.advance(dt)` throws on a negative `dt`. A negative `dt` ran the
  clock backward and rewound springs. A `dt` of 0 is still allowed.
- `bounce: 1` throws in `defineSpring({ damping, bounce })` and
  `defineSpring({ tension, damping, bounce })`, as their docs already said.
  These shapes derive tension or mass from the damping, and at `bounce` 1
  the result blows up: `{ damping: 10, bounce: 1 }` derived a tension of
  2.5e9. Every other shape still accepts `bounce: 1`.
