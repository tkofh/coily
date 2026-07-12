# Proposal: shape springs (`SpringObject<T>`)

_Drafted 2026-07-08, from the design discussion following the 0.13 work
(config value semantics, strict event lifecycle, single-update-per-frame,
`settled`, reduced motion, imperative Vue access). Status: draft for markup._

## Motivation

`Spring2D` is a hand-rolled special case of the real endgame: springs over
arbitrary numeric shapes — `{ x, y, z }`, `{ position: { x, y }, opacity,
scale }`, color channels as `{ r, g, b }` — with one config for everything or
a config shaped like the value. 2D and 3D stop being features and become
instances.

## Architecture: composition in core, reactivity in Vue

The scalar physics core stays exactly as it is. Shape **composition** — not
reactivity — joins it in core as `SpringObject<T>`: flatten `T` into one
scalar `Spring` per numeric leaf ("channel"), reassemble value/velocity
objects on read. The Vue layer remains the thin bridge it already is.

Why core and not the Vue layer:

- **Vanilla/3D parity.** Three.js and canvas consumers are imperative and
  framework-free; shapes gated behind Vue would exclude the primary 3D
  audience. (Precedent: the confetti case needed the imperative layer.)
- **Everything composes for free when channels are real `Spring`s**:
  per-channel config with inherit semantics, channel-wise following with
  offset shapes, `settled`, reduced motion, pool adoption via `onDispose`,
  strict start/stop alternation. Reimplemented in a view layer, each of
  those is subtle work (the `onStart` dedup and config inheritance were
  both multi-step fixes for N=2).
- **The Vue bridge is already generic** over `SpringLike<V>`
  (`createReactiveSpringRef`). A core `SpringObject<T>` slots in nearly
  unchanged; `useSpring({ x: 0, opacity: 1 })` is mostly overload typing.
- **`Spring2D` must reduce to `SpringObject<Vector2>`.** If it can't, the
  design is wrong. This is the acceptance test.

## Shape model

- `T` is a nested record (tuples/arrays TBD, see open questions) whose
  leaves are all `number`. Enforced at the type level; runtime-validated at
  construction for JS callers.
- The shape is **fixed at creation**. Channels are leaf paths
  (`position.x`, `opacity`). Changing shape means creating a new object.
- **Partial targets are allowed**: `spring.target = { opacity: 0 }`
  retargets one channel and leaves the rest alone (`DeepPartial<T>`).
  Reading `target`/`value`/`velocity` always returns the full shape.
- Non-goals: string values, units, color strings, paths, transforms,
  keyframes. Numbers only, forever. Color support is `{ r, g, b }` in
  userland.

## Core API sketch

```ts
const spring = system.createSpringObject(
  { position: { x: 0, y: 0 }, opacity: 1 },
  { position: stiffConfig, opacity: gentleConfig }, // or one config for all
)

spring.target = { position: { x: 100, y: 50 } } // partial retarget
spring.value // Readonly<T>, stable cached object
spring.velocity // Readonly<T>
spring.config = null // revert all channels (per-channel null via config shape)
spring.jumpTo({ opacity: 0 }) // partial jump
await spring.settled // all channels at rest
spring.target = otherObject // channel-wise following
spring.target = { object: other, offset: { position: { x: 10 } } }
```

- `config: SpringConfig | ConfigShape<T> | null` where `ConfigShape<T>`
  mirrors `T` with `SpringConfig | null` at any level — a subtree value
  applies to every leaf below it. Per-channel inherit/follow semantics fall
  out of the existing `#override`/`#resolved` machinery unchanged.
- Events: `onStart` fires on the fully-resting → any-channel-moving
  transition (generalize the pairwise check: on channel start, fire iff
  every other channel rests); `onStop` when all channels rest; `onDispose`
  from any one channel (they dispose together); `timeRemaining` is the max.
- Reduced motion, pool adoption, and the Vue bridge need zero new code.

## The one new core mechanism: coalesced composite updates

N channels emit up to N `update` events per frame, so a composite
`onUpdate` would fire N× per frame — this is the known Spring2D double-emit,
multiplied. Fix it in core with an end-of-pass flush:

- `MotionSet.tick` gains a post-pass flush queue. A `SpringObject` (and
  `Spring2D`) registers a flush callback when any of its channels updates
  during a pass; after the iteration, the set runs and clears the queue.
- Composite `onUpdate` therefore fires **exactly once per frame** with all
  channels in their final per-frame state (no torn reads).
- Out-of-pass channel updates (e.g. synchronous `jumpTo`) flush
  immediately — there is no pending pass to wait for.
- Retroactively fixes Spring2D's double-emit. Should be benchmarked with a
  new object-shape bench suite (the chain benches set the precedent).

## Vue layer

- `useSpringObject(target, options?)` — or, preferably, fold into
  `useSpring` via overloads: `MaybeRefOrGetter<number>` → `SpringRef`,
  shape object → `SpringObjectRef<T>`. The `const T` inference plus a
  `Shape` constraint should keep hovers readable; needs a spike.
- Options accept `SpringOptions | SpringConfig | ConfigShape<T>` —
  reactive, resolved through the existing `resolveSpringConfig` pattern.
- `SpringRef`-style ref: writable `Ref<Readonly<T>>` with `velocity`,
  `isResting`, `timeRemaining`, `settled`, `jumpTo`, linked-ref targets.
- `useSpringPool().createSpringObject(...)` joins the pool surface.

## Migration

- `Spring2D` becomes sugar over `SpringObject<Vector2>` (keeps its
  vector-specific niceties; no churn for existing users). Revisit whether
  it survives 1.0 as an alias or gets deprecated.
- `useSpring2D` likewise. No core scalar changes at all.

## Open questions (mark up here)

1. Separate `createSpringObject`/`useSpringObject` vs overloading
   `createSpring`/`useSpring` on input type. Overloads read better; needs a
   type-ergonomics spike to confirm error messages stay humane.
   - preferrably we can use overloads to avoid the need for `*Object` api surface area, but if the types don't allow it then i'm fine with `createSpringObject`/`useSpringObject`
   - **Resolution (initial):** `useSpring` folded shapes in via overloads
     — every input it takes (number, ref, getter, branded ref) is
     runtime-distinguishable. Core kept `createSpringObject` because
     `SpringPosition`'s displaced form collided with `Shape<T>`:
     `{ target: 100, value: 0 }` was simultaneously a displaced scalar
     and a two-channel shape, with no runtime discriminator and different
     return types.
   - **Update (2026-07-11, release prep):** merged. Displaced creation
     was pure sugar — create-then-retarget/follow is observably
     equivalent, listeners can't exist during construction — so
     `SpringPosition` was dropped and the collision with it. One
     `createSpring` on `SpringSystem` and `SpringPool`: a number is a
     scalar spring, any object or array is a shape. `createSpringObject`
     is gone (see the merge-create-spring changeset).
2. Tuples/arrays in v1 (`[x, y]`, color triples), or records only first?
   - i think at the very least we should support numeric keys (i.e. `type Leaf = Record<string | number, number | Leaf>`), but if we can make arrays work as well i think that would be even better. feels like it would be incomplete without them.
3. Partial-target semantics: silently ignore unknown keys, or throw?
   (Lean: throw — unknown keys are typos, and the types prevent them.)
   - agree with throw, i want to be up front as much as possible with the behavior here.
4. Should the coalescing flush also become the delivery mechanism for
   _scalar_ follower updates someday (deterministic graph propagation), or
   stay composite-only?
   - hadn't thought about this but lets investigate it a bit, i'm a huge fan of determinism so if there are benefits to the scalar case we can glean from this or tackle at the same time, i'm all for giving it a try and thinking it through.
5. Does `ConfigShape` accept `SpringOptions` leaves (auto-`defineSpring`)
   or require built `SpringConfig`s? (Lean: accept both, mirroring
   `UseSpringOptions`.)
   - my initial response was going to be "accept only `SpringConfig`" because i wasn't sure how we'd differentiate, but given the valid paths come from the input object not the config object, i think we would be safe to accept the `SpringOptions` leaves as well.
   - **Update (2026-07-11, release prep):** reversed — `ConfigShape` accepts
     only `SpringConfig` (via `defineSpring`) and `null`. Accepting bare
     `SpringOptions` leaves forced a keys-vs-namespace disambiguation
     heuristic (a spring-option key set, plus an `AnnotationContext`
     threaded through the whole shape traversal to tell "config for this
     subtree" from "descend into it"). Requiring `SpringConfig` deletes all
     of it: a plain object is unambiguously a config shape. The scalar
     `useSpring`/`SpringValue` paths keep the bare-options convenience by
     normalizing at the Vue boundary (`resolveSpringConfig`), which the
     nested object case can't reuse cheaply. Easy to add back later if the
     ergonomics are missed (see the drop-bare-options changeset).

## Suggested implementation order

1. Coalescing flush in `MotionSet` + retrofit `Spring2D` composite events
   onto it (fixes the known double-emit; benchmarkable immediately).
2. Core `SpringObject<T>`: flatten/reassemble + config shapes + composite
   events on the flush. Acceptance test: reimplement `Spring2D` on top and
   run its entire existing suite against the wrapper.
3. Types: `Shape` constraint, `DeepPartial`, `ConfigShape`, with a
   `*.test-d.ts` suite like the `defineSpring` one.
4. Vue bridge + pool surface + Nuxt auto-imports.
5. Benches (object churn, wide shapes, mixed configs), README, changeset.
