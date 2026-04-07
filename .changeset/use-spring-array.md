---
"coily": minor
---

`useSpring` and `useSpring2D` now accept an array of targets, returning a tuple of refs sharing the same config.

```ts
const [width, height] = useSpring([targetWidth, targetHeight], bouncyOptions)
```
