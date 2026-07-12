---
'coily': minor
---

Follow offsets generalize into computed targets. `SpringWithOffset` and
`CompositeSpringWithOffset` are gone; in their place, `SpringTarget` is now
`number | SpringSource`, where `SpringSource` is the followable contract
every `Spring` implements and `mapSpring` derives new sources from
existing ones with any pure function of the value:

```ts
// before                                          // after
follower.target = { spring: leader, offset: 20 }   follower.target = mapSpring(leader, (v) => v + 20)
```

Maps compose, and one source can lead many springs. Followers inherit
config and detach on dispose through a map exactly as they would
following the spring directly. The contract is open — implement it
(brand with `SpringSourceSymbol`) to make any live value followable —
and `Spring` gained `onConfigure`, which subscribes to resolved config
changes.

Object-level offset shapes had no replacement and no known use, so
channel-wise following now takes the leader composite spring bare:
`follower.target = leader`.
