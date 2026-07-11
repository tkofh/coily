---
'coily': patch
---

The input shape types now carry `readonly` channels: `PartialShape<T>`,
`ConfigShape<T>`, and both fields of `SpringObjectWithOffset<T>`. This only
hardens the library's own contract — a `readonly`-typed parameter still
accepts mutable objects, so every existing call site (`spring.value = {…}`,
`jumpTo`, `set config`, `{ spring, offset }` targets) keeps working
unchanged. Runtime behaviour is identical. The one thing that no longer
typechecks is annotating a local with one of these exact types and then
mutating it in place, which the library never intended you to do — build the
input and pass it. (`ReadonlyShape<T>` outputs from `target`/`value`/
`velocity` were already deep-readonly.)
