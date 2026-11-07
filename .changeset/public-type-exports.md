---
'coily': minor
---

Export the types that public signatures use, so you can name them in your
own code. `coily` now exports `Shape`, `PartialShape`, `ReadonlyShape`,
`TargetShape`, `SourceShape`, `SourceValues`, `SpringSourceApi`,
`KinematicSourceApi`, and `TargetedSourceApi`. The three api types let you
write a custom source with a typed api object. `coily/vue` now exports
`UseSpringConfig`, `UseCompositeSpringConfig`, and `SpringValueSlotScope`.

`SpringDefinition` is now a value export as well as a type, so
`SpringDefinition.default` and `instanceof SpringDefinition` work from an
import of `coily`.
