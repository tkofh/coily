---
'coily': minor
---

Under reduced motion a spring snaps straight to its target. That's right
for the motion springs usually drive, a translate or a scale, but wrong
for one animating a cross-fade or a color, where there's no motion to
reduce. `createSpring` now takes a third `options` argument carrying a
`purpose`:

```ts
// snaps to its target under reduced motion (the default)
system.createSpring(0, config)

// keeps animating under reduced motion: it changes how something looks,
// not where it is
system.createSpring(0, config, { purpose: 'appearance' })
```

`'appearance'` opts a spring out of reduced motion: its retargets and its
value and velocity writes animate as normal, and turning reduced motion on
leaves it running. `'motion'` is the default, so every existing spring
still snaps.

A composite takes a purpose per channel: one `Purpose` for the whole
spring, or a shape that sets a purpose on any channel or subtree. One
spring can then move and fade at once:

```ts
// x and y snap; opacity keeps fading
system.createSpring({ x: 0, y: 0, opacity: 1 }, config, {
  purpose: { opacity: 'appearance' },
})
```

Read it back from `spring.purpose`: a `Purpose` on a `Spring`, or
`Purpose | null` on a `CompositeSpring`, which is `null` when its channels
disagree. In Vue it rides a non-reactive third argument:
`useSpring(target, config, { purpose: 'appearance' })`. `<SpringValue>`
gains a `purpose` prop, and `useSpringPool().createSpring` matches the
system signature.
