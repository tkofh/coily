---
"coily": minor
---

First-class imperative access to the provided spring system in Vue.

- **`useSpringSystem()` is now an idempotent accessor**: it returns the
  system provided by the current component or an ancestor, and only when
  none exists does it create one, provide it, and start/stop it with the
  component lifecycle. It now returns the `SpringSystem` (previously
  `void`), and repeated calls return the same instance. Options apply only
  when a system is actually created. Root-level `useSpringSystem(options)`
  call sites keep working unchanged.
- **`useSpringPool()`** (new) returns `createSpring`/`createSpring2D` bound
  to the provided system, with every created spring automatically disposed
  when the component's effect scope is torn down — imperative, dynamic
  spring sets (particles, per-item effects) can no longer leak motions.
  Disposing a spring manually first is fine; it unregisters itself.
- **`spring.onDispose(cb)`** (new, core) — subscribe to a spring's disposal
  on `Spring` and `Spring2D`; this is what the pool builds on. Calling
  `dispose()` twice is now an explicit no-op.
- Provide/inject now uses a local-provide pattern, so `useSpring` and
  friends work in the same component that provided the system — previously
  that threw.
- The "no SpringSystem" error now says how to fix it: install the
  coily/nuxt module or call `useSpringSystem()` in an ancestor component.
- The Nuxt module auto-imports `useSpringSystem` and `useSpringPool`.
