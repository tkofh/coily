---
"coily": minor
---

Add `spring.settled` — a promise that resolves when the spring next comes to
rest, making animation sequencing a one-liner:

```ts
spring.target = 100
await spring.settled
next.target = 50
```

Modeled on the Web Animations API's `animation.finished`:

- Resolves immediately if the spring is already resting.
- The same promise instance is returned for the duration of a motion cycle;
  a new cycle gets a new promise.
- Retargeting mid-flight extends the wait — it resolves only at true rest.
- It never rejects: disposing the spring resolves a pending promise.

Available on `Spring`, `Spring2D`, and Vue's `SpringRef` / `SpringRef2D`.
