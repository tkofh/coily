Coily has a sound foundation: anchored closed-form solvers, a small mutable physics state, an explicit follow graph, and separate Vue, Nuxt, and CSS entry points. The architecture is worth preserving. The highest priorities are to enforce system ownership, complete the separation between advancement and event delivery, strengthen config validation, and fix numerical boundary cases.

Reviewed on November 7, 2026. Source locations refer to the reviewed checkout at `/Users/tim/projects/coily`, revision `0b8fefb1a7d77f9d663a9e1dd2ff1ddcc6e7fbb4`. Findings concern the behavior observed during the review; proposed changes below have not been implemented.

# Scope and validation

The review covered the core spring and ramp APIs, numerical solvers, config resolution and duration tuning, source derivation, follow graph, composites and shape traversal, scheduling, event lifecycle, Vue and Nuxt integration, CSS generation, tests, benchmarks, documentation, and repository verification setup.

| Verification                          | Result                                                     |
| ------------------------------------- | ---------------------------------------------------------- |
| Complete unit, Vue, and browser suite | 640 tests passed across 28 test files                      |
| Typechecking, lint, and formatting    | Passed with `pnpm check`                                   |
| Library build                         | Passed with `pnpm --filter coily build`                    |
| Built entry point imports             | `coily`, `coily/css`, `coily/vue`, and `coily/nuxt` loaded |
| Core line coverage                    | 98.08%                                                     |
| Core branch coverage                  | 93.63%                                                     |

The coverage configuration excludes `src/vue/**`. These percentages describe the core, not the complete integration surface. Passing tests do not cover the failures below.

Priority definitions: **P1** means address promptly because supported usage can corrupt state across system boundaries. **P2** means a reproducible correctness or contract failure that should be fixed in the relevant feature. **P3** means robustness or maintenance work with a narrower impact.

# Findings to address

## F01 Cross system following corrupts follower state

**Priority: P1.** A follower belonging to one spring system can change value when only another system advances, then jump backward when its own system advances.

Locations: [motion-set.ts](/Users/tim/projects/coily/packages/coily/src/motion-set.ts:323), [follow-graph.ts](/Users/tim/projects/coily/packages/coily/src/follow-graph.ts:223), [spring.ts](/Users/tim/projects/coily/packages/coily/src/spring.ts:440).

```ts
import { createSpringSystem } from 'coily'

const a = createSpringSystem({ couplingTolerance: 1e9 })
const b = createSpringSystem({ couplingTolerance: 1e9 })
const leader = a.createSpring(0)
a.createSpring(leader)
const foreign = b.createSpring(leader)
a.advance(0)
b.advance(0)

leader.target = 100
a.advance(16)
foreign.value // 2.8628466678774913, although b has not advanced
b.advance(16)
foreign.value // 0.02852713409907537
```

Graph edges attach follower lists and scheduling markers to shared motion objects without separating system ownership. The ordered pass recouples a popped motion before checking whether it belongs to the active set. A foreign follower receives a new target and an armed slope, but its simulation does not advance in that pass.

**Change:** Represent the owning `MotionSet` explicitly. Treat a source owned by another system as a subscription-only source, or reject cross-system following with a clear error. Ownership must be distinct from active membership because legitimate resting followers are also outside the active set.

**Verify:** Advance the two systems independently in both orders. Include spring and ramp leaders, mapped sources, resting followers, and multiple followers distributed across systems. A follower's value must move only when its owning system advances or receives a documented synchronous write.

## F02 Derived configs accept zero damping and produce invalid physics

**Priority: P2.** Accepted, typed inputs can derive zero mass or tension and poison a spring with `NaN` value and velocity.

Location: [config.ts](/Users/tim/projects/coily/packages/coily/src/config.ts:306).

```ts
import { defineSpring } from 'coily'

defineSpring({ damping: 0, dampingRatio: 1 })
// Derives tension 0 and naturalFrequency 0.

defineSpring({ tension: 100, damping: 0, dampingRatio: 1 })
// Derives mass 0 and naturalFrequency Infinity.

defineSpring({ damping: 0, duration: 500, dampingRatio: 1 })
// Derives mass 0, tension 0, and naturalFrequency NaN.
```

Creating and retargeting a spring with any of these configs produces invalid state that remains active. Input finiteness checks do not guarantee that derived parameters are valid.

**Change:** Require positive damping in the input shapes that need it to derive positive mass or tension. Preserve zero damping where mass and tension are independently determined. Validate resolved mass, tension, damping, frequency, damping ratio, and resting threshold before freezing the definition; this also catches intermediate overflow and underflow from finite inputs.

**Verify:** Exercise zero and near-zero boundaries for every supported config shape. Every returned definition must have a usable finite physical state, or construction must throw a useful error.

## F03 Arrival stop can skip an imminent target crossing

**Priority: P2.** A spring configured to stop at its target can render a substantial overshoot when its target is one representable value away and it has incoming velocity.

Locations: [solver.ts](/Users/tim/projects/coily/packages/coily/src/solver.ts:49), duplicated in [config.ts](/Users/tim/projects/coily/packages/coily/src/config.ts:509).

```ts
import { createSpringSystem, defineSpring } from 'coily'

const system = createSpringSystem({ reducedMotion: 'never' })
const spring = system.createSpring(
  100,
  defineSpring({ tension: 100, dampingRatio: 0.1, arrival: 'stop' }),
)
spring.velocity = -1000
spring.target = 99.99999999999999

spring.timeRemaining // 315.74194169982763 ms
system.advance(16)
spring.value // 84.32038990768528
spring.isResting // false
```

The crossing is effectively immediate, but `atan2` rounds the angle to `-Math.PI`. Taking `% Math.PI` erases the small positive root, and the adjustment schedules a whole half-period later. A tiny numerical error becomes approximately 15.68 units of overshoot. Negative arrival multipliers can likewise cross instead of rebounding.

**Change:** Compute the first positive crossing angle without reducing a near-pi result modulo pi. For nonzero displacement, a sign-normalized angle can preserve the small root; handle exactly zero displacement separately. Put crossing calculations in a shared numerical helper so the solver and time estimator cannot diverge.

**Verify:** Test adjacent representable targets with substantial velocity toward the target, both displacement signs, stop and rebound arrivals, zero displacement, and steps that span the crossing.

## F04 Recoupling can emit callbacks during the advance phase

**Priority: P2.** The intended silent advance phase runs `start` callbacks for some followers. Disposal can then throw an internal error, and nested advancement can silently skip unrelated springs.

Locations: [spring.ts](/Users/tim/projects/coily/packages/coily/src/spring.ts:428), [spring-motion.ts](/Users/tim/projects/coily/packages/coily/src/spring-motion.ts:298), [motion-set.ts](/Users/tim/projects/coily/packages/coily/src/motion-set.ts:307).

```ts
import { createSpringSystem, defineSpring } from 'coily'

const system = createSpringSystem({ couplingTolerance: 1e9 })
const leader = system.createSpring(0)
const follower = system.createSpring(
  leader,
  defineSpring({ duration: 500, dampingRatio: 1, arrival: 0 }),
)
follower.onStart(() => follower.dispose())
leader.target = 100
system.advance(16) // Throws: Cannot tick a disposed motion
```

Arrival, cyclic, and zero-step recoupling routes through `#setTarget`, whose position setter can synchronously emit `start`. A nested `advance(0)` from that callback also increments the shared pass counter. The outer pass can mistake motions touched by the nested pass for motions it already advanced. Separate reentrant heaps protect the worklists but not the full pass state.

**Change:** Buffer transitions caused by recoupling and publish them during notification. Give each pass its own immutable identity and explicit context. Keep synchronous public writes consistent with their documented event timing.

**Verify:** Test start handlers that dispose, retarget, throw once, and invoke nested zero-time or nonzero-time advancement. Confirm that unrelated motions receive the expected elapsed time and that callbacks observe the promised frame state.

## F05 A terminal listener exception can strand settled promises

**Priority: P2.** If an update listener throws on the final frame, an already acquired `settled` promise can remain pending forever even though the object rests. Its stop event can also be lost.

Locations: [spring-motion.ts](/Users/tim/projects/coily/packages/coily/src/spring-motion.ts:193), [motion-set.ts](/Users/tim/projects/coily/packages/coily/src/motion-set.ts:337), [ramp-motion.ts](/Users/tim/projects/coily/packages/coily/src/ramp-motion.ts:187), [composite-spring.ts](/Users/tim/projects/coily/packages/coily/src/composite-spring.ts:214).

Reproduction: start a motion, retain its `settled` promise, and register an update listener that throws once when `isResting` becomes true. Catch the error from an advance long enough to finish the motion, then keep advancing. The state rests, but the retained promise remains pending and `onStop` never runs. This was reproduced for a scalar spring, a ramp, and a composite.

Resting motions leave the active set before notification. An exception from update delivery skips lifecycle reconciliation, and future ticks no longer visit the object. The current thrown-listener tests exercise a mid-flight exception, where subsequent frames hide this problem.

**Change:** Complete internal rest transitions, cleanup, and promise resolution independently of public listener execution order. Continue to surface listener exceptions, but do not let them permanently prevent internal reconciliation.

**Verify:** Throw on terminal updates, including when several objects finish together. Retained promises must resolve, internal running state must agree with rest, and the documented stop-event policy must remain consistent.

## F06 Vue refs of core sources fail through proxy access

**Priority: P2.** Ordinary Vue refs containing core springs or ramps typecheck as supported targets but fail at runtime.

Location: [vue/spring.ts](/Users/tim/projects/coily/packages/coily/src/vue/spring.ts:154), including subsequent target resolution at lines 180 through 189.

```ts
// Inside setup with a provided SpringSystem:
const leader = ref(system.createSpring(0))
const follower = useSpring(leader)
// Throws a private-field access error for #motion.
```

Vue deep-proxies the core class. Its source getter then accesses a private field through the proxy. A core ramp inside `ref`, or a getter returning a core source from a reactive container, has the same risk. Direct sources and `shallowRef` work.

**Change:** Normalize proxied core sources with `toRaw` before accessing the source protocol, including on reactive leader changes. Consider consolidating the special scalar linked-ref path with the general source resolution path so raw handling has one implementation.

**Verify:** Cover ordinary refs, shallow refs, reactive containers, getter-based leader switches, core springs and ramps, and the library's own source refs. Keep following independent of Vue animation dependencies.

## F07 Duration tuning is discontinuous near critical damping

**Priority: P2.** A one-ulp adjustment above a damping ratio of 1 changes a nominal 500 ms animation into a 173 ms animation.

Locations: [config.ts](/Users/tim/projects/coily/packages/coily/src/config.ts:487), matching remaining-time bound at [config.ts](/Users/tim/projects/coily/packages/coily/src/config.ts:459).

Starting one unit away, using `{ duration: 500, dampingRatio }`, and advancing on a 1 ms grid:

| Damping ratio        | Reported remaining time | Actual rest |
| -------------------- | ----------------------- | ----------- |
| `1`                  | 500 ms                  | 500 ms      |
| `1 + Number.EPSILON` | About 500 ms            | 173 ms      |
| `1.00000001`         | About 500 ms            | 275 ms      |
| `1.0001`             | About 500 ms            | 398 ms      |
| `1.001`              | About 500 ms            | 445 ms      |
| `1.01`               | About 500 ms            | 490 ms      |
| `2`                  | About 500 ms            | 500 ms      |

The absolute sum of overdamped mode amplitudes becomes arbitrarily loose near critical damping, although the physical trajectory approaches the critical trajectory continuously. Inverting the loose bound makes the tuned spring much stiffer.

The bound still honors a conservative no-later-than interpretation. It does not honor the stronger documented non-bouncy duration behavior, and it introduces a visible tuning discontinuity.

**Change:** Tune non-oscillating motion from its actual from-rest amplitude using an expression stable in the critical limit. Keep the broader remaining-time estimate conservative for arbitrary initial states, but describe its slack accurately.

**Verify:** Sweep damping ratios on both sides of 1, including adjacent floats, with several displacements and precisions. Check actual rest time and continuity of the trajectory, not only that the tuning and estimator return the same duration.

## F08 CSS error diagnostics understate the emitted error

**Priority: P2.** The requested approximation error does not include serialization rounding or error between the original sample points.

Locations: [css.ts sampling](/Users/tim/projects/coily/packages/coily/src/css.ts:112), [css.ts diagnostic](/Users/tim/projects/coily/packages/coily/src/css.ts:128), [css.ts serialization](/Users/tim/projects/coily/packages/coily/src/css.ts:222).

```ts
const result = springToLinear(defineSpring({ tension: 200, damping: 0 }), { maxError: 1e-7 })
result.maxError // 0
```

Parsing the emitted easing and comparing it at 100,001 inputs with the exact normalized sinusoid finds approximately `0.0000830021349` maximum error, about 830 times the requested budget. The diagnostic compares unrounded polylines only at the original sample locations. The emitted values and percentages use fixed rounding precision.

The absolute 0.1 ms sampling floor creates a more pronounced short-duration failure: a critically damped 0.1 ms config returns `linear(0, 1)` with zero reported error. The actual midpoint progress is about `0.91372629`, whereas the generated easing gives `0.5`.

**Change:** Allocate the error budget across sampling, simplification, and serialization. Adapt sample density and output precision to the requested budget, or explicitly constrain supported budgets. Validate displacement and duration-cap inputs as well.

**Verify:** Parse and evaluate the returned string independently. Include error between samples, rounding of stop percentages, tight budgets, short durations, and nonzero initial velocity.

## F09 Reduced motion can change the initial ramp value during hydration

**Priority: P2.** Default user-preference detection can make server and client render different initial ramp values.

Locations: [vue/nuxt.ts](/Users/tim/projects/coily/packages/coily/src/vue/nuxt.ts:66), [vue/ramp.ts](/Users/tim/projects/coily/packages/coily/src/vue/ramp.ts:115), [system.ts](/Users/tim/projects/coily/packages/coily/src/system.ts:100).

```ts
const ramp = useRamp(100, 100, { from: 0 })
// Render ramp.value in the template.
```

A default system created without `window` renders `0` on the server. On a client with reduced motion enabled, the default system immediately snaps the ramp to `100`. Vue reports a hydration mismatch. This was reproduced with Vue SSR and hydration; the Nuxt plugin constructs its system before hydration and has the same initial-state difference.

**Change:** Preserve the server's initial value through hydration, then reconcile the user preference. Avoid adding a preference-dependent difference to the first client render.

**Verify:** Run SSR and hydration tests with reduced motion on and off, finite and endless targets, explicit `from` values, and nonmotion purposes. Add an integration test for the generated Nuxt plugin.

# Additional robustness and lifecycle work

## Shape identities and record keys

**Priority: P3.** In [composite-spring.ts](/Users/tim/projects/coily/packages/coily/src/composite-spring.ts:258), purposes are indexed by dot-separated paths. The shape `{ 'a.b': 0, a: { b: 0 } }` has two distinct channels that both map to `a.b`, so one can inherit the other's purpose. Under reduced motion, this can make a motion channel animate incorrectly. Use structural identities or unambiguous path segments rather than diagnostic strings as keys.

Record mirrors in [shape-tree.ts](/Users/tim/projects/coily/packages/coily/src/shape-tree.ts:270) use normal assignment into `{}`. An own `__proto__` channel from parsed JSON disappears or becomes the mirror's prototype instead of an own branch. Create own properties safely. Explicitly reject sparse arrays with a path-specific message; they currently reach an internal `undefined.mirror` failure.

## Rest after configuration changes

Changing precision can make `isResting` immediately true and `timeRemaining` zero before the value and velocity have been normalized. A newly read `settled` can therefore resolve while the value still differs from the target. For example, a default 0-to-1 spring after 250 ms has value about `0.91372629`; switching to precision 0 makes it resting before the next tick snaps it to 1. Align the state transition and promise contract, or document precisely when normalization occurs. See [spring-motion.ts](/Users/tim/projects/coily/packages/coily/src/spring-motion.ts:91).

## Nuxt application ownership

The generated plugin creates and starts an app-owned system but registers no application teardown. Add cleanup when the Vue app unmounts so page-visibility listeners, reduced-motion listeners, and the ticker do not outlive the application. Cover teardown and development reload behavior. See [vue/nuxt.ts](/Users/tim/projects/coily/packages/coily/src/vue/nuxt.ts:66).

## Supported numerical ranges

Very large accepted damping ratios can lose the slow overdamped rate through subtraction. At a ratio of `1e8`, `sigma - wd` rounds to zero in a tested direct config, freezing the spring and producing an infinite remaining time. Either constrain the supported range or use a rationalized slow-rate expression. Treat this as lower priority than the ordinary-input failures in F02, F03, and F07.

# Architecture and source organization

Keep the existing solver, state, motion, scheduler, graph, shape, and adapter boundaries. The small state representation and anchored closed forms are appropriate for this library. The Vue layer generally keeps framework reactivity separate from simulation, and scope cleanup is consistently applied to its composables.

The most valuable architectural work is enforcing invariants at these boundaries:

- **Ownership:** A motion has one owning system. Global source discovery must not make scheduling state global.

- **Event phases:** Coupling and advancement update simulation state; notification publishes lifecycle changes afterward. Internal lifecycle completion must survive listener errors.

- **Pass context:** A nested advance needs its own identity, worklists, and phase context. Mutable scheduler fields should not implicitly identify whichever pass most recently ran.

- **Shared mathematics:** Crossing calculations used by solvers and time estimation should share one implementation and boundary tests.

`config.ts` combines public option types, validation, parameter derivation, duration tuning, and remaining-time calculations. Separating parameter resolution from timing mathematics would make its numerical contracts easier to test. Broad directory moves are less valuable than these focused changes.

The scalar Vue linked-ref path duplicates behavior supported by the source protocol. Consolidate source resolution where practical, while retaining a deliberate solution for composite identity and shape compatibility. Nuxt also repeats core option types, documentation, and serialization branches; reduce that duplication to prevent drift when system options grow.

# Testing recommendations

Coverage is already high. Improve the strength and distribution of the assertions before pursuing a higher percentage.

In [properties.spec.ts](/Users/tim/projects/coily/packages/coily/test/properties.spec.ts:83), the test named resting value is at the target permits at least one whole unit of error. Use exact equality for the exact-rest contract. The overdamped monotonicity test permits several violations, and the energy test requires only 80% of sampled transitions to decrease. Replace these allowances with bounds justified by the property being tested and floating-point scale.

Several convergence horizons come from `computeTimeRemaining` in the same implementation. A shared error in tuning and estimation can therefore make both agree. Add independent reference evaluations and check actual motion, not only internal consistency.

Target these populations and behaviors:

- Every supported config shape at zero and near-zero boundaries, plus validity of resolved parameters.

- Nonzero initial velocity in every damping regime.

- Exact critical damping and ratios immediately above and below it.

- Adjacent representable targets with substantial incoming velocity.

- Exact target equality after rest, stop, and chain settlement.

- Cross-system relationships, leader disposal, graph rewiring, and rest/wake churn.

- Start, stop, update, and dispose callbacks that mutate state, nest advancement, or throw on terminal frames.

- Parsed CSS output evaluated independently of its own diagnostic.

- Vue proxies and reactive source containers, SSR, hydration, and Nuxt application teardown.

The current root verification does not typecheck or build the playgrounds because their packages lack corresponding scripts. Add appropriate checks if the demos are intended to validate integrations. Add a packed-package consumer test to exercise generated declarations and export resolution separately from imports of source files.

Include Vue in a coverage report or provide a separate integration report. Its current exclusion makes the headline coverage percentages easy to misinterpret.

# Performance assessment and benchmark recommendations

Selected local Node measurements support the impression that the core is fast:

| Prepared workload                                    | Approximate simulation cost per frame |
| ---------------------------------------------------- | ------------------------------------- |
| 10,000 continuously moving scalar springs            | 0.35 ms                               |
| Warmed 512-spring chain led by a constant-speed ramp | 0.08 ms                               |

These are local microbenchmarks without DOM rendering. The chain was warmed into continuing motion before timing. They describe selected steady workloads, not worst-case browser frame cost.

The current advance-one-frame benchmarks in [spring.bench.ts](/Users/tim/projects/coily/packages/coily/test/spring.bench.ts:25) create and retarget springs inside the timed body. Keep creation benchmarks, but add prepared fixtures that isolate frame advancement.

Measure the following before introducing more scheduler complexity:

- One-step versus eight-step coupling and irregular frame intervals.

- Fan-out, multi-source maps, graph rewiring, and disposal churn.

- Mixed disconnected components, including one component that demands the full sub-step count.

- Vue subscriptions and DOM updates separately from pure simulation.

- Allocation and garbage collection during continuous retargeting and creation.

All graph-connected components currently share the maximum sub-step demand. This is a reasonable simplicity tradeoff, but it may make one demanding component increase work for otherwise quiet components. Profile that workload before implementing per-component stepping.

Flattening map pipelines avoids recursive reads, but extending a map copies the entire pipeline in [spring-source.ts](/Users/tim/projects/coily/packages/coily/src/spring-source.ts:198). Constructing an N-map chain performs quadratic aggregate copying. Keep this tradeoff unless deep construction is important; if it is, consider persistent storage with lazy compilation.

Arrival handling also processes every crossing individually. Extremely stiff elastic rebounds can produce thousands of crossings in one frame. Algebraically skipping regular half-periods is a possible optimization after correctness at crossing boundaries is secured.

# Comments and numerical documentation

Most internal comments explain useful constraints, invariants, and numerical choices. Preserve that approach. Fix implementation violations of documented invariants rather than deleting the comments that reveal them.

The strongest documentation concern is overclaiming exactness. [PRECISION.md](/Users/tim/projects/coily/PRECISION.md:12) argues from individually rounded operations to a trajectory starting only a few ulps away. That conclusion does not follow automatically: cancellation can magnify error, transcendental functions are not generally guaranteed to be correctly rounded, and accumulated time still has rounding error.

A defensible description is that Coily evaluates closed-form trajectories without numerical integration error. Distinguish that from floating-point evaluation error, rest thresholds, and approximate follower coupling. State supported parameter ranges and attach measured accuracy claims to their tested conditions.

Correct the claim that mutual followers settle to the same shared value at every frame rate. With initial values 0 and 100 and a config of tension 170 and damping 26, a tested mutual-follow pair settled at about `50.13744719` using 120 fps steps and `50.64138865` using 30 fps steps. The method approximates coupled motion; the discrepancy should be described and tested rather than presented as exact invariance.

Reconcile duration documentation with the bound slack in F07. Also distinguish the requested CSS approximation budget from measured error of the actual serialized easing.

One smaller comment at [css.ts](/Users/tim/projects/coily/packages/coily/src/css.ts:146) describes a flat tail after early rest, but the sampled resting point is not snapped to 1 before the endpoint is appended. The added segment slopes toward the target. Snap the sample as the core does, or correct the comment.

# Suggested implementation order

1. **Enforce ownership and event phases.** Address F01, F04, and F05 together with focused lifecycle tests. These establish the invariants needed for reliable feature composition.

2. **Repair config and crossing boundaries.** Address F02 and F03, validate resolved definitions, and share crossing calculations.

3. **Stabilize timing and generated easing.** Address F07 and F08 with independent numerical checks and continuity tests.

4. **Close integration gaps.** Address F06 and F09, add Nuxt teardown, and cover SSR, hydration, and ordinary Vue proxies.

5. **Harden shape handling and contracts.** Fix purpose-path collisions, special record keys, sparse arrays, and the rest-normalization transition.

6. **Strengthen verification and documentation.** Improve property-test oracles, add built-package and playground checks, isolate performance measurements, and narrow numerical claims to the behavior actually supported.

Each fix should include a regression for the concrete failure and tests of the neighboring behavior it must preserve. Rerun the complete suite and package build after the related changes; use benchmark comparisons where changes affect the solver or scheduler hot path.
