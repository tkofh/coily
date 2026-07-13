---
'coily': minor
---

`SpringObject` is renamed to `CompositeSpring` — the docs already
described it as "a composite spring over a fixed numeric shape," and now
the name says so. The family renames with it: `SpringObjectTarget` is
now `CompositeSpringTarget`, and in the Vue layer `SpringObjectRef` is
now `CompositeSpringRef`. Everything describing the value rather than the
spring — channels, `ConfigShape` — keeps its name.
