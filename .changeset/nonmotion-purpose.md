---
'coily': minor
---

Breaking: rename the `'appearance'` purpose to `'nonmotion'`. The old word
covered values that change how something looks, such as a cross-fade, a
color, or a blur, but not values that move nothing at all, such as a number
that never reaches the screen. `'nonmotion'` names what every such value
shares, and its behavior is unchanged: it keeps animating under reduced
motion. `'appearance'` is removed with no alias and now throws the
invalid-purpose error. Replace it wherever a purpose is accepted:
`createSpring`, composite purpose shapes, `useSpring`,
`useSpringPool().createSpring`, and the `<SpringValue>` `purpose` prop.

```ts
system.createSpring(1, config, { purpose: 'nonmotion' })
```
