---
'coily': minor
---

`SpringSystem.reducedMotion` accepts a `ReducedMotionMode` (`'user'`,
`'always'`, or `'never'`) and applies it at once. Reads still return
whether reduced motion is on. Turning it on finishes in-flight motion, and
`'user'` starts following the OS setting. Use it for an in-app motion
setting, or to hydrate a server-rendered app: create the system with
`'never'`, mount, then assign `'user'`.

The Nuxt module does this for you. Under `'user'`, a server-rendered page
hydrates without the preference and without frames, as the server rendered
it, then applies the preference and starts. A ramp or retarget no longer
renders a different first value on a client that prefers reduced motion.
