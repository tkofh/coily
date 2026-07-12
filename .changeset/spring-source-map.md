---
'coily': minor
---

Springs can follow live values, not just fixed numbers. `SpringTarget`
is now `number | SpringSource`, where `SpringSource<T>` is an open
contract (`T` defaults to `number`): every `Spring` is a source, every
`CompositeSpring` is a source of its value shape, and any object
honoring the contract — brand it with `SpringSourceSymbol` — can bridge
a pointer position or scroll offset into the graph. `Spring` and
`CompositeSpring` gained `onConfigure`, which subscribes to resolved
config changes (coalesced per write batch or tick on composites).

`mapSpring` derives new sources by a pure function of existing ones:

```ts
// one spring: offsets, mirrors, clamps
follower.target = mapSpring(leader, (v) => v + 20)

// a shape of sources combines several springs
distance.target = mapSpring({ x, y }, ({ x, y }) => Math.hypot(x, y))

// a composite spring maps as a whole
magnitude.target = mapSpring(point, ({ x, y }) => Math.hypot(x, y))
```

An optional third argument pins the config the derived source offers
followers — a `SpringDefinition`, or `null` to offer none. Omitted, the
config the sources share passes through, changes included: a single
source's own, a composite's channel-shared config, and for shapes the
config every leaf offers when they all agree (none while any differ).
Followers inherit config and detach on dispose through a
map exactly as if following the spring directly; a derived value is
released with the first of its sources. Composition is flat — mapping a
mapped source extends its pipeline instead of nesting it — so chains of
any length read iteratively and subscribe at their roots.

Only scalar sources can be followed directly: assigning a composite to
`Spring.target` throws, pointing at `mapSpring`.

`SpringWithOffset` and `CompositeSpringWithOffset` are removed — a map
is the general form of an offset. Object-level offset shapes had no
replacement and no known use, so channel-wise following now takes the
leader composite bare: `follower.target = leader`.
