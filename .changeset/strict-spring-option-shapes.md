---
"coily": minor
---

`defineSpring` input shapes are now enforced by the type system.

Previously the option types were laxer than the runtime: `mass` was accepted
by every shape even where the constructor derives it — silently ignored with
`tension + damping + dampingRatio`, and a runtime throw with duration-based
configs. Mixed shapes (e.g. `dampingRatio` together with `bounce`) could also
slip through the union and resolve unexpectedly.

- Shapes that derive mass (`tension + damping + dampingRatio`/`bounce`, and
  duration-based configs constrained by `tension` or `damping`) now reject a
  provided `mass` at compile time.
- Each input shape now rejects properties belonging to other shapes, so mixed
  configs fail to type-check instead of resolving to an unintended shape.
- For plain-JS callers the same rules are enforced at runtime with clear
  errors: providing `mass` where it is derived, or both `dampingRatio` and
  `bounce`, now throws instead of being silently ignored.

If a config that previously compiled now errors, the `mass` you were passing
was never taking effect — remove it, or switch to a shape that accepts mass.
