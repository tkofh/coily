---
'coily': patch
---

Fix two `useSpring` bugs in `coily/vue`.

- `useSpring(() => (pick.value ? left : right))` threw when `left` and
  `right` were object `useSpring` refs. It now follows the current leader
  channel by channel and switches leaders when the getter changes. A getter
  can also switch between a leader and a plain shape. A `CompositeSpring`
  from `useSpringPool` can be a leader too, directly or from a getter or
  ref.
  A shape-valued source that is not a composite, such as
  `velocityOf(composite)`, now throws a clear error instead of following
  nothing.
- `timeRemaining` on a `useSpring` ref went stale after a retarget from
  rest. The spring emits no update until the next frame, so an effect
  reading `timeRemaining` kept seeing 0 while the spring had started to
  move. The ref now also triggers when the spring starts and stops.
