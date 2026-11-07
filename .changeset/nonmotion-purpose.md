---
'coily': minor
---

Breaking: rename the `'appearance'` purpose to `'nonmotion'`. Replace it
everywhere a purpose is accepted: `createSpring`, composite purpose shapes,
`useSpring`, `useSpringPool().createSpring`, and the `<SpringValue>`
`purpose` prop. `'appearance'` has no alias and now throws the
invalid-purpose error.

```ts
system.createSpring(1, config, { purpose: 'nonmotion' })
```

The old word covered values that change how something looks, such as a
cross-fade, a color, or a blur. It did not cover values that move nothing at
all, such as a number that never reaches the screen. `'nonmotion'` names
what all of these values share. The behavior does not change: a
`'nonmotion'` value keeps animating under reduced motion.
