---
'coily': patch
---

Fix `SpringConfig` mutation tracking when the class gets duplicated across bundler chunks (observed under Nuxt + Vite).

The version counter previously used a `#version` ECMAScript private field, accessed through static `SpringConfig.version()` and `SpringConfig.assign()` methods. When Vite inlined `SpringConfig` into multiple chunks, the static methods on one copy could not access private fields on instances of another copy, throwing at runtime. The version counter is now a regular `_version` field (marked `@internal` and stripped from the public `.d.ts`), and `assign` is an instance method — both of which dispatch through whichever copy of the class created the instance, sidestepping the duplication problem.
