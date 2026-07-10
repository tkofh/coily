---
'coily': minor
---

Respect `prefers-reduced-motion` by default.

When reduced motion is active, springs snap to their targets instead of
animating: retargets and value writes apply instantly (followers collapse
with their leaders), velocity impulses are ignored, and springs created
displaced start at their target. Events stay coherent — one `update` per
change, no `start`/`stop`, and `settled` resolves immediately — so code
written against the animated path keeps working.

Configure it with the new `reducedMotion` option on `createSpringSystem`
(and the Nuxt module's `coily` config):

- `'user'` (default) — follow `prefers-reduced-motion`, reacting to live
  changes; enabling it mid-flight finishes active animations instantly.
  Inactive where `matchMedia` is unavailable (SSR, node).
- `'always'` / `'never'` — force the behavior either way.

`system.reducedMotion` exposes the current state so applications can gate
purely decorative effects themselves.

This is on by default: users with a reduced-motion OS preference will now
see instant transitions instead of spring animations. Pass
`reducedMotion: 'never'` to opt out and handle the preference yourself.
