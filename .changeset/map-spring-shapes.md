---
'coily': minor
---

`mapSpring` accepts a shape of sources: pass a plain object or array with
`SpringSource` leaves and a pure function of their values to derive one
followable value from several springs —
`mapSpring({ x, y }, ({ x, y }) => Math.hypot(x, y), null)`. Several
sources leave no single config to inherit, so shape maps take a required
third argument: the config the derived source offers followers, or `null`
to offer none. The same argument is optional on single-source maps, where
it pins the offered config instead of passing the source's through.
