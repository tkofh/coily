---
'coily': minor
---

`createSpring` now creates both scalar and composite springs, and
`createCompositeSpring` is gone: pass a number for a `Spring`, a numeric
shape for a `CompositeSpring`, on `SpringSystem` and `useSpringPool()`
alike.

To make the two forms unambiguous, `createSpring` no longer takes a
target/value pair (the `SpringPosition` type is gone; a literal like
`{ target: 100, value: 0 }` is now a two-channel shape). Displaced
creation was sugar for create-then-write, and the two stay exactly
equivalent, since retargets and follows preserve the spring's value and
momentum:

```ts
// before                                              // after
system.createSpring({ target: 100, value: 0 })         const spring = system.createSpring(0)
                                                       spring.target = 100

system.createSpring({ target: leader })                const follower = system.createSpring(leader.value)
                                                       follower.target = leader
```

Passing a source directly, `system.createSpring(leader)`, is the same
create-then-follow in one call.
