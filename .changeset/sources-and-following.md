---
'coily': minor
---

Springs can follow a live value, not just a fixed number. Assign a source
to a spring's `target` and it chases that source as the source moves,
momentum intact. Every `Spring` and `CompositeSpring` is itself a source,
so one spring leads another with a plain assignment:

```ts
follower.target = leader
```

`SpringTarget` widens from `number` to `number | SpringSource` to carry
this.

`mapSpring` transforms and combines sources. A follower can offset,
mirror, clamp, or fuse several leaders into a single value:

```ts
// offset one spring
follower.target = mapSpring(leader, (v) => v + 20)

// fuse several into a distance
distance.target = mapSpring({ x, y }, ({ x, y }) => Math.hypot(x, y))
```

A composite spring follows per channel. Name a channel to hand it a number
or a source; leave a channel out and it keeps following its leader:

```ts
follower.target = { x: 5, y: mapSpring(lead, ({ x }) => -x) }
```

`createSpring` takes a source too, on `SpringSystem` and pools alike: the
spring starts at the source's current value and follows from birth.

A source carries a value, never a config, so following changes what a
spring chases and never how it moves. Cleanup stays automatic: a follower
detaches when its leader is disposed, and a mapped source is released with
the leaders behind it.

A composite can't be a target on its own: assign one to `Spring.target`
and it throws, pointing you at `mapSpring` to reduce it to a number. The
object passed to a shape map is reused between reads, so read what you need
and don't keep a reference to it.

`SpringWithOffset` and `CompositeSpringWithOffset` are gone; a map is the
general form of an offset. To follow a composite channel-for-channel, pass
the leader bare.
