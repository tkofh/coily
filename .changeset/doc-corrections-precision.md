---
'coily': patch
---

Correct and extend the docs.

- `useSpringPool` and `useSpring` say to hold core springs and ramps in a
  `shallowRef` or `shallowReactive`, or wrap them in `markRaw`. A deep
  `ref` or `reactive` proxy cannot reach their private fields.
- Mutual followers settle on a shared value that shifts slightly with the
  frame rate. The README said the value was the same at any frame rate.
- PRECISION.md separates closed-form evaluation, which has no integration
  error, from floating-point evaluation error. It also describes the rest
  time bounds now in use and states the conditions behind each accuracy
  figure.
