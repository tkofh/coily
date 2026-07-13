---
'coily': minor
---

`useSpring` refs are `SpringSource`s, and `useSpring` follows sources.
A `SpringRef` or `CompositeSpringRef` goes anywhere a source does — a
`mapSpring` input or leaf, a composite channel target, a pool's
`createSpring` — and `useSpring` accepts a source, or a ref/getter of
one, as its target: `useSpring(() => (split.value ? left : right))`
switches leaders live, momentum intact.

Following bypasses Vue reactivity entirely: a ref's source slot reads
its backing spring directly, so a follower's reads never track into an
active effect. An effect that displaces a leader, or a getter that
returns one, re-runs only when its own dependencies change — never per
animation frame.
