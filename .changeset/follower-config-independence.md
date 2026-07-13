---
'coily': minor
---

Followers no longer inherit their leader's config. A spring always moves
by its own config: the one it was created with or last assigned, or the
default. Following a source sets only what the spring chases, so
reconfiguring a leader no longer reaches its followers, a scalar follower
no longer adopts its leader's config, and a composite channel no longer
adopts its leader channel's. `Spring.onConfigure` and
`CompositeSpring.onConfigure` are gone with the old cascade, and assigning
`null` to `config` now always reverts to the default. In Vue,
`useSpring(leaderRef)` with no options animates with the default config.

To give a follower the leader's feel, pass a config when you create it,
either a shared `defineSpring` constant or a snapshot of the leader's:

```ts
const follower = system.createSpring(leader, leader.config)
```

That snapshot is one-time: reconfigure the leader afterward and the
follower keeps the feel it was born with.
