---
"coily": minor
---

`useSpring` now accepts an array of targets, returning a tuple of `SpringRef`s sharing the same config.

```ts
const [x, y] = useSpring([mouseX, mouseY], bouncyOptions)
```
