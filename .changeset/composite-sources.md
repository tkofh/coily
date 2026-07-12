---
'coily': minor
---

`CompositeSpring` is now a `SpringSource` of its value shape, and
`SpringSource<T>` is generic over its value (`T` defaults to `number`,
so scalar sources are unchanged). `mapSpring` reads composites like any
other source — bare (`mapSpring(point, ({ x, y }) => Math.hypot(x, y),
null)`) or at the leaves of a shape — so scalar springs can follow
values derived from whole composites. Only scalar sources can be
followed directly; assigning a composite to `Spring.target` throws,
pointing at `mapSpring`. `CompositeSpring` also gains `onConfigure`,
coalesced like its other events: at most one per write batch or tick.
