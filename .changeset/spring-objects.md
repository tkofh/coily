---
'coily': minor
---

Add spring objects: springs over arbitrary numeric shapes.

`system.createSpringObject(value, config?)` animates any plain object or
array whose leaves are numbers, nested arbitrarily. Each leaf becomes an
independent scalar channel behind one composite API:

```ts
const spring = system.createSpringObject({ position: { x: 0, y: 0 }, opacity: 1 })

spring.target = { position: { x: 100 } } // partial — other channels are left alone
await spring.settled
```

- Partial writes throughout: `target`, `value`, `velocity`, and `jumpTo`
  all take partial shapes and leave unnamed channels alone. Unknown
  channels throw with their path (`position.z`).
- Per-channel configs: pass one config for every channel, or a shape
  mirroring the value with configs (or option objects, or `null`) at any
  level — a config at a subtree covers every channel below it. Value
  shapes own their key namespace: where a channel is named like a spring
  option, pass a `SpringConfig` or per-channel shape, not a bare options
  object.
- Channel-wise chaining: assign another spring object of the exact same
  shape as `target`, optionally `{ spring, offset }` with a partial offset
  shape. A partial numeric target detaches only the channels it names.
- Coalesced events: `update` fires at most once per frame with every
  channel in its final per-frame state, and `stop` lands after that
  frame's final `update`. `settled` and reduced motion compose
  channel-wise.
- Shapes are validated at compile time via the new `Shape` type
  (interfaces work without index signatures; non-numeric, optional, and
  `undefined`-typed channels are rejected at the offending property), with
  runtime validation backing untyped callers. Also exported:
  `PartialShape`, `ReadonlyShape`, `ConfigShape`, `SpringObjectTarget`,
  `SpringObjectWithOffset`.

In Vue, `useSpring` accepts shapes directly — records and arrays, plain or
behind a ref or getter — and returns a `SpringObjectRef`: reads are the
deep-readonly composite value, writes take partial shapes, options accept
reactive per-channel config shapes, and passing another `SpringObjectRef`
follows it channel-wise. Deeply reactive targets retarget on nested
mutation. `useSpringPool()` gains `createSpringObject`.

The Vue entry point now requires `vue >= 3.5`: its ref types use the
two-parameter `Ref<Get, Set>` to type reads as full shapes and writes as
partials.
