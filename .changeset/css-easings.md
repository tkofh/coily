---
'coily': minor
---

Add `coily/css`: turn a spring config into static CSS. A spring released
from rest has a displacement-independent normalized curve, so its shape is
a pure function of the config — which is exactly what a CSS `linear()`
easing wants. The module is pure (no DOM, no ticker), so it runs at build
time or once up front rather than per frame.

- `springToLinear(config, options?)` samples the trajectory into a
  `linear()` easing and the duration in ms to pair it with. The duration
  comes from `computeTimeRemaining`, so a duration-tuned config's easing
  spans exactly the time it was tuned for.
- `springToWaapi(config, spec | specs)` returns `{ keyframes, options }`
  for `element.animate`.
- `springToCss(config, spec | specs, { name })` returns a `@keyframes`
  rule and an `animation` shorthand value.
- `springToTransition(config, spec | specs)` returns a `transition` value
  for springing a `:hover` or class change.
- `springFromState(config, state)` and `springStateAt(config, state,
elapsedMs)` regenerate an animation from a spring caught mid-flight, so
  an interrupted Web Animations API animation carries momentum instead of
  restarting from rest. A `velocity` on a spec routes `springToWaapi`
  through the same from-state path.

An array of specs drives several properties from one spring, sharing a
single easing so they settle in sync; specs on the same property (several
`transform` functions) space-join into one value. A pure undamped spring
(`dampingRatio: 0`) has no rest to settle at, so it becomes a seamless
infinite loop instead: the easing spans one half period and the animation
runs `infinite alternate`.

```ts
import { defineSpring } from 'coily'
import { springToWaapi } from 'coily/css'

const { keyframes, options } = springToWaapi(defineSpring({ bounce: 0.5, duration: 500 }), {
  property: 'translate',
  from: 0,
  to: 300,
  unit: 'px',
})
element.animate(keyframes, options)
```
