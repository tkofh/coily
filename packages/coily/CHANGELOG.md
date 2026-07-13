# Change Log

## 0.14.0

### Minor Changes

- 0a22ad4: Followers no longer inherit their leader's config. A spring always moves
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

- 0a22ad4: `velocityOf` and `accelerationOf` make a source out of a spring's motion:
  its velocity (how fast its value is changing, in value units per second)
  or its acceleration (how fast that velocity is changing). You follow them
  and map them like any other source, so an effect can ride a spring's
  motion instead of its position:

  ```ts
  // a blur that chases how fast something is moving
  blur.target = velocityOf(motion)

  // an impact flash from a sharp change in speed
  flash.target = mapSpring(accelerationOf(motion), (a) => Math.min(1, Math.abs(a) * 1e-4))
  ```

  Derive from a scalar and you get a scalar to follow; derive from a
  composite and you get the same shape, ready to reduce with `mapSpring`.
  There's nothing to clean up: each derived source lives and dies with the
  spring behind it.

  `Spring` and `CompositeSpring` also gain a read-only `acceleration` (value
  units per second squared) next to `velocity`. It is exact, not estimated
  frame to frame.

  Only a `Spring` or a `CompositeSpring` is in motion, so only those can be
  derived. A `mapSpring` result isn't, so `velocityOf` and `accelerationOf`
  reject it, in the types and at runtime.

- 0a22ad4: `createSpring` now creates both scalar and composite springs, and
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

- 0a22ad4: Finalized the public type surface for 1.0: renamed the types whose old
  names undersold them, and dropped the ones you never needed to name.

  Two renames, types-only:

  - `SpringObject` is now `CompositeSpring`: the docs already called it "a
    composite spring over a fixed numeric shape," and now the name says so.
    The family renames with it: `SpringObjectTarget` is now
    `CompositeSpringTarget`, and in the Vue layer `SpringObjectRef` is now
    `CompositeSpringRef`.
  - `SpringConfig` is now `SpringDefinition`, and `SpringOptions` is now
    `SpringDefinitionOptions`, completing the `defineSpring` story: options
    are the plain objects you write inline, and a definition is the immutable
    artifact `defineSpring` builds from them.

  Everything describing the value rather than the spring keeps its name
  (channels, `ConfigShape`), and so do `spring.config` and the `config`
  parameters, since "config" is the role a definition plays on a spring.

  Types that only ever appeared inferred, or as constraints on coily's own
  signatures, are no longer exported. You had no reason to write their names,
  and every one left public is a type we'd have to keep.

  - Shape utilities `Shape`, `PartialShape`, `ReadonlyShape`, `TargetShape`,
    `SourceShape`, and `SourceValues` are gone from the public API. They
    shaped `createSpring` and `mapSpring`'s own parameters and returns; the
    values you pass and receive are unchanged, you just can't name the
    helper.
  - The source api slots `SpringSourceApi` and `KinematicSourceApi` are now
    internal. `SpringSource` and `KinematicSource` stay: supplying your own
    source isn't a supported pattern for now, so the shape under the symbol
    is no longer part of the contract.
  - `TickerOptions` folds into `SpringSystemOptions`, which already carried
    its `fps`, `lagThreshold`, and `adjustedLag` fields.
  - The Vue reactive config-input types (`UseSpringObjectOptions` and its
    scalar counterpart) are no longer exported; pass config inline through
    `useSpring`'s second argument.

  What remains is deliberate: the values, the objects you hold (`Spring`,
  `CompositeSpring`, `SpringSystem`, `SpringDefinition`, the Vue refs,
  `SpringPool`), the source types (`SpringSource`, `KinematicSource`,
  `SpringSourceSymbol`), the inputs you build (`SpringSystemOptions`,
  `SpringOptions`, `CompositeSpringOptions`, `ConfigShape`, `PurposeShape`,
  `SpringDefinitionOptions`), and the named concepts (`Purpose`,
  `SpringTarget`, `CompositeSpringTarget`).

- 0a22ad4: Springs can follow a live value, not just a fixed number. Assign a source
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

- 0a22ad4: Under reduced motion a spring snaps straight to its target. That's right
  for the motion springs usually drive, a translate or a scale, but wrong
  for one animating a cross-fade or a color, where there's no motion to
  reduce. `createSpring` now takes a third `options` argument carrying a
  `purpose`:

  ```ts
  // snaps to its target under reduced motion (the default)
  system.createSpring(0, config)

  // keeps animating under reduced motion: it changes how something looks,
  // not where it is
  system.createSpring(0, config, { purpose: 'appearance' })
  ```

  `'appearance'` opts a spring out of reduced motion: its retargets and its
  value and velocity writes animate as normal, and turning reduced motion on
  leaves it running. `'motion'` is the default, so every existing spring
  still snaps.

  A composite takes a purpose per channel: one `Purpose` for the whole
  spring, or a shape that sets a purpose on any channel or subtree. One
  spring can then move and fade at once:

  ```ts
  // x and y snap; opacity keeps fading
  system.createSpring({ x: 0, y: 0, opacity: 1 }, config, {
    purpose: { opacity: 'appearance' },
  })
  ```

  Read it back from `spring.purpose`: a `Purpose` on a `Spring`, or
  `Purpose | null` on a `CompositeSpring`, which is `null` when its channels
  disagree. In Vue it rides a non-reactive third argument:
  `useSpring(target, config, { purpose: 'appearance' })`. `<SpringValue>`
  gains a `purpose` prop, and `useSpringPool().createSpring` matches the
  system signature.

- 0a22ad4: A `useSpring` ref is now a source, and `useSpring` follows sources. Hand a
  `SpringRef` or `CompositeSpringRef` anywhere a source is accepted (a
  `mapSpring` input, a composite channel target, a pool's `createSpring`),
  and give `useSpring` a source, or a ref or getter of one, as its target. A
  getter switches leaders live, momentum intact:

  ```ts
  useSpring(() => (split.value ? left : right))
  ```

  Following a ref doesn't drag Vue's reactivity along with it. Reading a
  leader through a follow never registers as a dependency, so an effect that
  moves a leader, or a getter that picks one, re-runs only when its own data
  changes, never once per animation frame.

### Patch Changes

- 0a22ad4: A `NaN` or infinity used to slip in and corrupt the simulation with no
  warning: one bad number, and every value it touched read `NaN` from then
  on. Now the bad value throws where you introduce it: assigning it to
  `target`, `value`, or `velocity`, or passing it to `jumpTo`,
  `createSpring`, `advance`, or a composite write. A composite write names
  the offending channel in the error. `defineSpring` rejects non-finite
  options the same way, and a followed source that produces a non-finite
  value throws as the follower retargets, surfacing from `advance` or your
  frame callback.
- 0a22ad4: A listener that throws during a frame no longer kills the animation loop.
  The error still surfaces from the frame callback, so you see it, and the
  loop keeps stepping the other springs instead of stopping dead at the
  first exception. A listener that calls `stop()` mid-frame now stops
  cleanly, with no stray frame scheduled behind it. Manual `advance()` loops
  are unchanged: the exception reaches the caller, and your next `advance()`
  picks up where the pass left off.

## 0.13.1

### Patch Changes

- f8e575a: The input shape types now carry `readonly` channels: `PartialShape<T>`,
  `ConfigShape<T>`, and both fields of `SpringObjectWithOffset<T>`. This only
  hardens the library's own contract — a `readonly`-typed parameter still
  accepts mutable objects, so every existing call site (`spring.value = {…}`,
  `jumpTo`, `set config`, `{ spring, offset }` targets) keeps working
  unchanged. Runtime behaviour is identical. The one thing that no longer
  typechecks is annotating a local with one of these exact types and then
  mutating it in place, which the library never intended you to do — build the
  input and pass it. (`ReadonlyShape<T>` outputs from `target`/`value`/
  `velocity` were already deep-readonly.)

## 0.13.0

### Minor Changes

- 6fbddd5: `useSpring` and `useSpring2D` no longer take arrays of targets. An array
  passed to `useSpring` now creates one spring object over the array shape —
  `useSpring([0, 0])` is a single two-channel spring (tuple-typed, so the
  arity is checked) — matching every other wrapping of the same value. For
  several independent scalar springs, map over the targets instead;
  composables are loop-safe:

  ```ts
  const springs = targets.map((t) => useSpring(t))
  ```

- 6fbddd5: Remove the 2D API: `createSpring2D`, `Spring2D`, `useSpring2D`,
  `SpringRef2D`, the pool's `createSpring2D`, and the `Vector2` type. Spring
  objects are a strict superset — a 2D spring is a spring object over
  `{ x, y }`:

  ```ts
  system.createSpring2D({ x: 0, y: 0 }) // before
  system.createSpringObject({ x: 0, y: 0 }) // after — same API, plus partial writes

  useSpring2D(target) // before
  useSpring(target) // after
  ```

  Displaced creation composes from create + retarget, with identical
  semantics including under reduced motion:

  ```ts
  system.createSpring2D({ target, value }) // before

  const spring = system.createSpringObject(value) // after
  spring.target = target
  ```

  Following works the same in the object form — `spring.target = leader`, or
  `{ spring: leader, offset: { x: 20 } }` (offsets are partial shapes). Two
  observable differences: the `tension`/`damping` convenience getters are
  gone (read them off `spring.config`), and `config` reads
  `SpringConfig | null`, since channels can diverge under per-channel
  configs.

- 6fbddd5: `value` and `velocity` are now exact — reads are no longer rounded to the
  configured precision. `precision` means what its documentation always
  said: it sets the resting threshold (half a unit in the last place,
  0.5 × 10⁻ᵖ) and nothing else. At rest, `value === target` exactly, since
  rest zeroes the state; mid-flight values simply carry their full float
  digits. `SpringConfig.precisionMultiplier` is removed along with the
  rounding it served.

  Resting detection now measures the decay envelope instead of boxing
  position and velocity separately: a spring rests when
  `|x| + |v|/ωₙ ≤ 0.5 × 10⁻ᵖ`, the same effective amplitude the
  `timeRemaining` estimate uses (which now reports 0 exactly when resting).
  The old check compared velocity — units per second — against a threshold
  in value units, which misjudged rest in both directions: stiff springs
  ticked extra tail frames after their motion stopped being resolvable, and
  soft springs (ωₙ < 1) could be declared resting while still carrying
  enough velocity to move visibly, cutting real motion short. Velocity now
  counts as the future travel it can actually produce, so rest timing is
  correct across the full stiffness range.

- 6fbddd5: First-class imperative access to the provided spring system in Vue.

  - **`useSpringSystem()` is now an idempotent accessor**: it returns the
    system provided by the current component or an ancestor, and only when
    none exists does it create one, provide it, and start/stop it with the
    component lifecycle. It now returns the `SpringSystem` (previously
    `void`), and repeated calls return the same instance. Options apply only
    when a system is actually created. Root-level `useSpringSystem(options)`
    call sites keep working unchanged.
  - **`useSpringPool()`** (new) returns `createSpring`/`createSpring2D` bound
    to the provided system, with every created spring automatically disposed
    when the component's effect scope is torn down — imperative, dynamic
    spring sets (particles, per-item effects) can no longer leak motions.
    Disposing a spring manually first is fine; it unregisters itself.
  - **`spring.onDispose(cb)`** (new, core) — subscribe to a spring's disposal
    on `Spring` and `Spring2D`; this is what the pool builds on. Calling
    `dispose()` twice is now an explicit no-op.
  - Provide/inject now uses a local-provide pattern, so `useSpring` and
    friends work in the same component that provided the system — previously
    that threw.
  - The "no SpringSystem" error now says how to fix it: install the
    coily/nuxt module or call `useSpringSystem()` in an ancestor component.
  - The Nuxt module auto-imports `useSpringSystem` and `useSpringPool`.

- 0d16f59: `onStart` and `onStop` now describe the spring's logical animation state and
  alternate strictly: `start` fires only on the resting → moving transition, and
  `stop` only on moving → resting.

  Previously, `start` fired on every retarget while a spring was already moving
  (so a follower emitted it every frame), never fired for `velocity` kicks, and
  `jumpTo` on an already-resting spring emitted a spurious `stop`.

  - Retargeting a moving spring no longer re-fires `start`; it fires again only
    after the spring has come to rest.
  - Setting `velocity` on a resting spring now fires `start`.
  - `jumpTo` fires `stop` only when it actually interrupts motion.
  - `Spring2D` fires `start` once per fully-resting → moving transition instead
    of once per axis, mirroring how `stop` already waited for both axes.

- 6fbddd5: The Nuxt module now forwards `fps`, `lagThreshold`, and `adjustedLag` to
  the shared spring system, so the app-wide ticker can be configured from
  module options. With the new uncapped default nothing needs configuring —
  the plumbing exists for apps that want an explicit ceiling or different
  lag handling.
- 6fbddd5: Respect `prefers-reduced-motion` by default.

  When reduced motion is active, springs snap to their targets instead of
  animating: retargets and value writes apply instantly (followers collapse
  with their leaders), velocity impulses are ignored, and springs created
  displaced start at their target. Events stay coherent — one `update` per
  change, no `start`/`stop`, and `settled` resolves immediately — so code
  written against the animated path keeps working.

  Configure it with the new `reducedMotion` option on `createSpringSystem`
  (and the Nuxt module's `coily` config):

  - `'user'` (default) — follow `prefers-reduced-motion`, reacting to live
    changes; enabling it mid-flight finishes active animations instantly.
    Inactive where `matchMedia` is unavailable (SSR, node).
  - `'always'` / `'never'` — force the behavior either way.

  `system.reducedMotion` exposes the current state so applications can gate
  purely decorative effects themselves.

  This is on by default: users with a reduced-motion OS preference will now
  see instant transitions instead of spring animations. Pass
  `reducedMotion: 'never'` to opt out and handle the preference yourself.

- 6fbddd5: Add `spring.settled` — a promise that resolves when the spring next comes to
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

- 6fbddd5: Add spring objects: springs over arbitrary numeric shapes.

  `system.createSpringObject(value, config?)` animates any plain object or
  array whose leaves are numbers, nested arbitrarily. Each leaf becomes an
  independent scalar channel behind one composite API:

  ```ts
  const spring = system.createSpringObject({
    position: { x: 0, y: 0 },
    opacity: 1,
  })

  spring.target = { position: { x: 100 } } // partial — other channels are left alone
  await spring.settled
  ```

  - Partial writes throughout: `target`, `value`, `velocity`, and `jumpTo`
    all take partial shapes and leave unnamed channels alone. Unknown
    channels throw with their path (`position.z`).
  - Per-channel configs: pass one `SpringConfig` for every channel, or a
    shape mirroring the value with configs (or `null`) at any level — a
    config at a subtree covers every channel below it. Configs are always
    `SpringConfig` instances (from `defineSpring`), so a plain object is
    unambiguously a per-channel shape, and any non-config leaf it reaches
    throws with its path.
  - Channel-wise chaining: assign another spring object of the exact same
    shape as `target`, optionally `{ spring, offset }` with a partial offset
    shape. A partial numeric target detaches only the channels it names.
  - Coalesced events: `update` fires at most once per frame with every
    channel in its final per-frame state, and `stop` lands after that
    frame's final `update`. `settled` and reduced motion compose
    channel-wise.
  - Shapes are validated at compile time via the new `Shape` type
    (interfaces work without index signatures; non-numeric, optional, and
    `undefined`-typed channels are rejected at the offending property), with
    runtime validation backing untyped callers. Also exported:
    `PartialShape`, `ReadonlyShape`, `ConfigShape`, `SpringObjectTarget`,
    `SpringObjectWithOffset`.

  In Vue, `useSpring` accepts shapes directly — records and arrays, plain or
  behind a ref or getter — and returns a `SpringObjectRef`: reads are the
  deep-readonly composite value, writes take partial shapes, options accept
  reactive per-channel config shapes, and passing another `SpringObjectRef`
  follows it channel-wise. Deeply reactive targets retarget on nested
  mutation. `useSpringPool()` gains `createSpringObject`.

  The Vue entry point now requires `vue >= 3.5`: its ref types use the
  two-parameter `Ref<Get, Set>` to type reads as full shapes and writes as
  partials.

- e1c3d53: `defineSpring` input shapes are now enforced by the type system.

  Previously the option types were laxer than the runtime: `mass` was accepted
  by every shape even where the constructor derives it — silently ignored with
  `tension + damping + dampingRatio`, and a runtime throw with duration-based
  configs. Mixed shapes (e.g. `dampingRatio` together with `bounce`) could also
  slip through the union and resolve unexpectedly.

  - Shapes that derive mass (`tension + damping + dampingRatio`/`bounce`, and
    duration-based configs constrained by `tension` or `damping`) now reject a
    provided `mass` at compile time.
  - Each input shape now rejects properties belonging to other shapes, so mixed
    configs fail to type-check instead of resolving to an unintended shape.
  - For plain-JS callers the same rules are enforced at runtime with clear
    errors: providing `mass` where it is derived, or both `dampingRatio` and
    `bounce`, now throws instead of being silently ignored.

  If a config that previously compiled now errors, the `mass` you were passing
  was never taking effect — remove it, or switch to a shape that accepts mass.

- 6fbddd5: `fps` no longer defaults to 60 — springs now advance once per displayed
  frame, at whatever rate the display actually refreshes. On a 120Hz panel
  the old default stepped (and painted) on every other frame, and because the
  60fps accumulator grid aliased against the frame grid, timestamp jitter
  interleaved 16.7ms and 25ms steps. Trajectories are unchanged (the solvers
  are closed-form, so tick frequency only picks sample points), so no spring
  configs need retuning. Pass `fps: 60` explicitly to restore the old pacing.

  `fps` is now an opt-in ceiling, with `0` (the new default) meaning
  uncapped — the same convention as `lagThreshold`'s `0` to disable lag
  detection. A cap is frame-paced: ticks land on whole display frames with
  half-a-frame tolerance, so a cap can never alias against vsync, and each
  capped tick's `delta` is still the true elapsed time across the frames it
  spans. Assigning `0` at runtime removes a cap. `tick()` and `deltaRatio`
  keep their meaning through the reference gap — `1000 / fps` when capped,
  1000/60 otherwise.

  The loop also costs nothing while idle: when every motion rests, no further
  animation frame is scheduled, and the next retarget, value, or velocity
  write wakes it. Waking (and starting) re-anchors the clock on the first
  frame callback instead of `performance.now()`, so idle time never becomes a
  physics step and the first delta can no longer be negative. The
  non-browser `setTimeout` fallback now forwards a timestamp to the frame
  callback (it previously passed none, producing `NaN` deltas).

### Patch Changes

- e1c3d53: Remove the `engines` field from the published package. It declared
  `node >= 24.10`, which caused installs to fail or warn on Node LTS versions
  for a library that runs anywhere. The constraint was a development-environment
  requirement and now lives in the monorepo root instead.
- 6fbddd5: Retargeting no longer feeds precision rounding back into spring state.
  Rebasing on retarget, solver re-anchoring after position/velocity/config
  writes, and follower target chasing all read the exact position now, so a
  retarget preserves the spring's value instead of perturbing it by up to
  half the precision quantum. Under per-pointermove retargeting (dragging)
  the old rebase jittered the value by ±0.005 on the default precision,
  forcing style damage at input rate; retarget round trips are now exact.

  Rest is also a fixpoint now: when a tick lands inside the resting
  threshold, the exact state is zeroed before the final update, so a
  follower's last rebase sees its leader's target precisely.

- 6fbddd5: Follows wired after creation now propagate in the same frame. Config
  inheritance parked resting followers in the motion set, consuming their
  once-per-frame tick before the leader moved — one frame of lag per link in
  late-wired chains.
- e1c3d53: Springs now emit exactly one `update` per frame.

  Previously, retargeting called an emitting zero-length tick, so a follower
  emitted twice per frame — and in chains the emissions cascaded: each spring's
  update retargeted the next, whose emission retargeted the one after, making
  per-frame emitter traffic quadratic in chain length. Retargets now re-baseline
  silently (a retarget never changes the spring's current value), so `update`
  means "a tick recomputed the value" and fires once per motion per frame.
  Chain benchmarks improve 4-8x (`settle 256-spring chain` +711%).

  Also fixed in the same pass:

  - Setting `spring.target` no longer emits a synchronous `update` — the next
    real tick reports it. `start`/`stop` still fire synchronously on transitions.
  - A follower that settled and was re-woken by its leader within the same tick
    pass no longer advances (and emits) twice in that frame; each motion now
    ticks at most once per pass.

- dbd22db: Fix a config aliasing bug and make `SpringConfig` a true immutable value.

  Previously, assigning `spring.config` on a spring that was sharing a config
  instance mutated that shared instance in place. In the worst case — a spring
  created without a config — this mutated the global default, silently retuning
  every other default-config spring in the app.

  `SpringConfig` instances are now frozen and never mutated. Springs track an
  explicit config override plus a resolved effective config, and config changes
  propagate to inheriting followers through an internal follower registry
  instead of shared mutable references. The internal `assign()` method and
  `_version` counter are gone, along with the per-tick version polling in the
  motion loop.

  Behavioral notes:

  - Springs constructed with the same `SpringConfig` instance are no longer
    coupled: reassigning one spring's config never affects another spring.
  - Disposing a leader now cleanly detaches its followers; they keep their
    current config and target and can be retargeted normally.
  - Config changes still propagate live through chains of inheriting followers,
    including transitively.

## 0.12.2

### Patch Changes

- 872af8f: Fix `SpringConfig` mutation tracking when the class gets duplicated across bundler chunks (observed under Nuxt + Vite).

  The version counter previously used a `#version` ECMAScript private field, accessed through static `SpringConfig.version()` and `SpringConfig.assign()` methods. When Vite inlined `SpringConfig` into multiple chunks, the static methods on one copy could not access private fields on instances of another copy, throwing at runtime. The version counter is now a regular `_version` field (marked `@internal` and stripped from the public `.d.ts`), and `assign` is an instance method — both of which dispatch through whichever copy of the class created the instance, sidestepping the duplication problem.

## 0.12.1

### Patch Changes

- Add `prepublishOnly` script to ensure the package is built before publishing.

## 0.12.0

### Minor Changes

- 0b96dd8: **BREAKING:** `SpringValue` component now takes a single `config` prop instead of individual `mass`/`tension`/`damping`/`precision` props. Accepts `SpringOptions` or a `SpringConfig` from `defineSpring()`.

  - `jumpTo` is now available in the slot scope
  - Component exposes `value`, `velocity`, `isResting`, `timeRemaining`, and `jumpTo` via template ref

- 0b96dd8: **BREAKING:** Rename `resting` to `isResting` across all APIs.

  - `spring.resting` → `spring.isResting`
  - `useSpring().resting` → `useSpring().isResting`
  - `SpringValue` slot prop `resting` → `isResting`

- 0b96dd8: **BREAKING:** `useSpring()` now returns a `SpringRef` instead of an object with separate `value`/`velocity`/`isResting`/`timeRemaining` refs.

  - `spring.value.value` → `spring.value` (the ref _is_ the value)
  - `spring.velocity`, `spring.isResting`, `spring.timeRemaining` are still refs on the object
  - `spring.jumpTo()` is now a method on the ref
  - Auto-unwraps in templates: `<div :style="{ opacity: spring }" />`

- 0b96dd8: Add `timeRemaining` property to springs, exposing the analytically estimated time (in milliseconds) until the spring comes to rest.

  - `spring.timeRemaining` available on the core `Spring` instance
  - `useSpring()` returns a reactive `timeRemaining` ref for Vue apps
  - `SpringConfig.computeTimeRemaining(state)` is available for standalone estimation

- 1f5ba85: Added `Spring2D` and `useSpring2D` for multi-dimensional spring animations. A `Spring2D` bundles two scalar springs behind a `Vector2`-aware API — no changes to the solver, each axis is independent.

  ```ts
  // Core
  const spring = system.createSpring2D({ x: 0, y: 0 })
  spring.target = { x: 100, y: 200 }

  // Vue
  const pos = useSpring2D(mouse, { dampingRatio: 1, duration: 500 })
  ```

  Springs can follow other springs via the `target` setter:

  ```ts
  const a = system.createSpring2D({ x: 0, y: 0 })
  const b = system.createSpring2D({ target: a })
  ```

- 0b96dd8: `useSpring` and `useSpring2D` now accept an array of targets, returning a tuple of refs sharing the same config.

  ```ts
  const [width, height] = useSpring([targetWidth, targetHeight], bouncyOptions)
  ```

## 0.11.0

### Minor Changes

- c99af28: Add `Spring.dispose()` for cleaning up event listeners and removing a spring from the scheduler.
- cc16cba: bring the vue and nuxt integrations into the main package via subpath exports and optional dependencies. vue is available at `coily/vue` and the nuxt module at `coily/nuxt`
- c99af28: Rename the `SpringValue` component's `friction` prop to `damping` to match the core API and `useSpring` options.

### Patch Changes

- 0f89ef6: Fix incorrect velocity computation in the overdamped spring solver. The derivative of `sinh`/`cosh` was using the sign pattern from the underdamped `sin`/`cos` derivative, causing velocity to be significantly overestimated for heavily overdamped springs. This could delay or prevent rest detection and produce incorrect `spring.velocity` values.
- c99af28: Fix springs producing incorrect motion when damping is changed mid-animation across regime boundaries (e.g., underdamped to overdamped). Fix ticker lag compensation being disabled after setting `lagThreshold` or `adjustedLag` at runtime.

## 0.10.1

### Patch Changes

- 3f6c1cc: ensure the initial value is correct regardless of whether `target`, `value`, or both are specified

## 0.10.0

### Minor Changes

- 14a6b8a: build as esm only

### Patch Changes

- 14a6b8a: explicitly export `SpringSystem` as an interface to avoid typescript trying to infer private properties
- 14a6b8a: immediately emit update events when changing value and target

## 0.9.0

### Minor Changes

- 6fbd43a: add `jumpTo` method to springs, which sets target and value and clears velocity

## 0.8.2

### Patch Changes

- 8827939: always emit events, even on synchronous changes

## 0.8.1

### Patch Changes

- 9a5f49c: fix: synchronous updates to both `target` and `value` now work properly

## 0.8.0

### Minor Changes

- 48b49a1: [breaking] replace `onRest` handler with `onStart` and `onStop` handlers

## 0.7.3

### Patch Changes

- 2560306: add component and nuxt module to vue integration

## 0.7.2

### Patch Changes

- update dependencies

## 0.7.1

### Patch Changes

- ensure spring state is updated immediately upon mutating value or target

## 0.7.0

### Minor Changes

- add mutable velocity and onRest handler

## 0.6.0

### Minor Changes

- use proper version for packages

## 0.5.1

### Patch Changes

- fixing build script

## 0.5.0

### Minor Changes

- refactor to improve math and performance

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.4.1](https://github.com/tkofh/coily/compare/coily@0.4.0...coily@0.4.1) (2023-04-09)

### Bug Fixes

- keep obj reference to config to allow updating ([1e5f495](https://github.com/tkofh/coily/commit/1e5f49519be7f58c4806b337096f394048c859ea))

# [0.4.0](https://github.com/tkofh/coily/compare/coily@0.3.0...coily@0.4.0) (2023-04-01)

### Features

- emit on spring system simulate ([d82e57d](https://github.com/tkofh/coily/commit/d82e57d28643fe2b25a5efe8e324da9342eeb84c))

# [0.3.0](https://github.com/tkofh/coily/compare/coily@0.2.0...coily@0.3.0) (2023-03-10)

### Features

- **coily:** jumpTo, function getters for props ([7c5351d](https://github.com/tkofh/coily/commit/7c5351d43bfef32e328c203933c483c52ea740cb))

# [0.2.0](https://github.com/tkofh/coily/compare/coily@0.1.1...coily@0.2.0) (2023-01-16)

### Features

- **@coily/vue:** breaking: factory plugin, simplify frozen api ([b92cc66](https://github.com/tkofh/coily/commit/b92cc66cc47fb905d75954637cbd84d78877ccc0))

## [0.1.1](https://github.com/tkofh/coily/compare/coily@0.1.0...coily@0.1.1) (2022-09-02)

### Bug Fixes

- **coily:** emit state update when target is set ([2bfe7b3](https://github.com/tkofh/coily/commit/2bfe7b340e6a2e2dca9a0c36f9d12580649ce396))

# 0.1.0 (2022-09-02)

**Note:** Version bump only for package coily
