---
'coily': minor
---

`defineSpring` rejects inputs that resolve to unusable physics.

- `damping` must be greater than 0 in a config that derives tension or mass
  from it: `{ damping, dampingRatio }`, `{ tension, damping, dampingRatio }`,
  their `bounce` forms, and duration configs with `damping`. A damping of 0
  derived a tension or mass of 0, and the spring's value became `NaN`.
  `{ tension, damping: 0 }` still makes an undamped spring.
- Finite inputs whose derived mass, tension, frequency, or resting threshold
  overflows or underflows throw, naming the parameter.
