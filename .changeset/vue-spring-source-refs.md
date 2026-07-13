---
'coily': minor
---

A `useSpring` ref is now a source, and `useSpring` follows sources. Hand a
`SpringRef` or `CompositeSpringRef` anywhere a source is accepted (a
`mapSpring` input, a composite channel target, a pool's `createSpring`),
and give `useSpring` a source, or a ref or getter of one, as its target. A
getter switches leaders live, momentum intact:

```ts
useSpring(() => (split.value ? left : right))
```

Following a ref doesn't drag Vue's reactivity along with it. Reading a
leader through a follow never registers as a dependency, so an effect that
moves a leader, or a getter that picks one, re-runs only when its own data
changes, never once per animation frame.
