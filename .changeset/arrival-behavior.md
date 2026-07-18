---
'coily': minor
---

Add `arrival` to spring configs: what the motion does when the value
reaches the target, as a velocity multiplier applied at every crossing.
`'passthrough'` (the default) keeps today's behavior. `'stop'` ends the
motion exactly on the target the first time the value gets there — an
exit animation can pick up speed with maximum bounce and still land
dead, with no overshoot. A number between -1 and 1 sets the multiplier
directly: negative values rebound off the target with that fraction of
the speed, values between 0 and 1 pass through slowed.

Crossings are solved in closed form from the spring's own solution
rather than sampled frame by frame, so a stop lands `value === target`
bit-for-bit at any step size, and `timeRemaining` reports the exact
crossing time for stopping springs. An `arrival: 'stop'` config also
rests an undamped spring (`dampingRatio: 0`), which otherwise never
settles.

```ts
const exit = defineSpring({ tension: 300, bounce: 0.9, arrival: 'stop' })
spring.config = exit
spring.target = 0
await spring.settled // resolves the instant the value first reaches 0
```
