---
'coily': patch
---

`useSpring` follows a core `Spring`, `Ramp`, or `CompositeSpring` held in a
`ref` or `reactive` container, or returned by a getter that reads one.
These threw a private-field error, because Vue's deep proxy cannot reach
the class's private fields. Writes to the core object still go through
the object itself rather than the proxy.
