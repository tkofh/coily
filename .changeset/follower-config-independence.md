---
'coily': minor
---

Followers no longer inherit config. A spring's config is always its
own — the one it was created with or last assigned, otherwise the
default. Following a source changes what the spring chases, never how
it moves: reconfiguring a leader no longer cascades to followers, a
scalar follower no longer adopts the leader's config, and composite
channels no longer adopt their leader channel's. `Spring.onConfigure`
and `CompositeSpring.onConfigure` are removed with the cascade;
assigning `null` to `config` now always reverts to the default. In
Vue, `useSpring(leaderRef)` without options animates with the default
config.

To give a follower the leader's feel, pass a config where the follower
is created — a shared `defineSpring` constant, or a snapshot of the
leader's:

```ts
const follower = system.createSpring(leader, leader.config)
```

The snapshot is one-time: reconfiguring the leader later leaves the
follower as it is.
