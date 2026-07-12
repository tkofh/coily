---
'coily': minor
---

`SpringObject` is renamed to `CompositeSpring` — the docs already
described it as "a composite spring over a fixed numeric shape," and now
the name says so. The family renames with it: `SpringObjectTarget` is
now `CompositeSpringTarget`, and in the Vue layer `SpringObjectRef` and
`UseSpringObjectOptions` are now `CompositeSpringRef` and
`UseCompositeSpringOptions`. Everything describing the value rather than
the spring — channels, `Shape`, `PartialShape`, `ReadonlyShape`,
`ConfigShape` — keeps its name.
