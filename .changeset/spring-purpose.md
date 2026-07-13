---
'coily': minor
---

Springs snap to their target under reduced motion, which is right for the
motion they usually drive — a translate, a scale — but wrong for a spring
animating a cross-fade or a color, where there is no motion to reduce.
`createSpring` now takes a third `options` argument carrying a `purpose`:

```ts
// snaps to its target under reduced motion (the default)
system.createSpring(0, config)

// keeps animating under reduced motion — it changes how something looks,
// not where it is
system.createSpring(0, config, { purpose: 'appearance' })
```

`'appearance'` opts a spring out of reduced motion entirely: its
retargets, value, and velocity writes animate as normal, and switching
reduced motion on leaves it running. `'motion'` is the default, so
existing springs still snap.

Composite springs take a purpose per channel — a single `Purpose` for
every channel, or a shape mirroring the value with a purpose at any
subtree covering the channels below it — so one spring can move and fade
at once:

```ts
// x and y snap; opacity keeps fading
system.createSpring({ x: 0, y: 0, opacity: 1 }, config, {
  purpose: { opacity: 'appearance' },
})
```

Read it back from `spring.purpose`: a `Purpose` on a `Spring`, and
`Purpose | null` on a `CompositeSpring` (`null` when channels differ). The
Vue layer threads it through a non-reactive third argument —
`useSpring(target, config, { purpose: 'appearance' })` — `<SpringValue>`
gains a `purpose` prop, and `useSpringPool().createSpring` mirrors the
system signature.
