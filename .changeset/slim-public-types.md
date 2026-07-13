---
'coily': minor
---

Slimmed the public type surface ahead of 1.0. Types that only ever
appeared inferred, or as constraints on coily's own signatures, are no
longer exported — you had no reason to write their names, and every one
left public is a shape we would have to keep.

- Shape utilities `Shape`, `PartialShape`, `ReadonlyShape`, `TargetShape`,
  `SourceShape`, and `SourceValues` are gone from the public API. They
  shaped `createSpring` and `mapSpring`'s own parameters and returns; the
  values you pass and receive are unchanged, you just can't name the
  helper.
- The source api slots `SpringSourceApi` and `KinematicSourceApi` are now
  internal. `SpringSource` and `KinematicSource` stay — supplying your own
  source isn't a supported pattern for now, so the shape under the symbol
  is no longer part of the contract.
- `TickerOptions` folds into `SpringSystemOptions`, which already carried
  its `fps`, `lagThreshold`, and `adjustedLag` fields.
- The Vue reactive config-input types (`UseSpringObjectOptions` and its
  scalar counterpart) are no longer exported; pass config inline through
  `useSpring`'s second argument.

What remains is deliberate: the values, the objects you hold (`Spring`,
`CompositeSpring`, `SpringSystem`, `SpringDefinition`, the Vue refs,
`SpringPool`), the source types (`SpringSource`, `KinematicSource`,
`SpringSourceSymbol`), the inputs you build (`SpringSystemOptions`,
`SpringOptions`, `CompositeSpringOptions`, `ConfigShape`, `PurposeShape`,
`SpringDefinitionOptions`), and the named concepts (`Purpose`,
`SpringTarget`, `CompositeSpringTarget`).
