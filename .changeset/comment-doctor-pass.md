---
'coily': patch
---

Document the public API surface with delivery-grade JSDoc: the `Spring` and `SpringObject` classes, `SpringSystem` and its options, `defineSpring` overloads, ticker options, and the whole `coily/vue` entry (`useSpring`, `useSpringSystem`, `useSpringPool`, `SpringValue`). Contracts were verified by execution — including a few previously undocumented behaviors: writes to a disposed spring throw, a follower keeps its inherited config after unfollowing, duration-based configs settle at or before the requested duration, and reduced-motion `value` writes move the target too.
