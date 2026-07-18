# Follower coupling: investigation findings

Status: Implemented in full — see section 9 for the record. Grew out of
a follower-coupling RFC (retired with the staged plan docs once
everything landed). Written after a multi-agent investigation: a
numerical treatment (34 numbered claims), an empirical probe driving
the real core, a tick-graph design worked against the code, and a
recovered bibliography — with every load-bearing claim adversarially
verified (33 upheld, 4 corrected; corrections are folded in below and
flagged). The acceptance and decision probes are preserved under
`probes/follower-coupling/` and run with plain `node` (Node >= 23 type
stripping imports the src `.ts` files directly); the intermediate
investigation scripts behind the remaining tables were retired once
their findings were folded in here and into `math-report.md` beside
this file.

## Headline findings

1. **The RFC misattributes its own kink explosion.** The 33-66 ms blowup
   is not within-frame ZOH hold error; it is the _frame-lag_ term,
   reintroduced at runtime by rest/wake churn. `MotionSet` deletes a
   motion when it rests; the next leader update re-adds it via
   `#setTarget -> MotionSet.add`, and a JS `Set` re-inserts a deleted key
   at the _end_ of iteration order. From then on that motion ticks after
   its own follower — a permanent one-frame-lag edge mid-chain. The demo
   hits this today, at default precision, with leader-first construction:
   the tick graph is not insurance against odd construction orders, it is
   a fix for an ordering defect that develops during normal operation.
2. **FOH is nearly free and behaves exactly as hoped on chains** — one
   affine transform around the three unchanged solvers, O(dt^2) vs
   O(dt), 15-79x accuracy at equal cost — but it needs three fences:
   tick-path deltas only (teleports stay steps), `arrival !== 1`
   followers fall back to step coupling, and **no FOH inside a cycle**
   (it destabilizes underdamped cycles that are stable under ZOH).
3. **The hybrid — FOH always, threshold-triggered sub-stepping — is a
   good idea and is empirically validated.** It held trajectory error
   flat at 0.03-0.45 px across dt = 4..66 ms while idling at K = 1 on
   quiet frames and spiking to K = 8 exactly on teleport frames, matching
   fixed K = 8 quality at 3.8x fewer solver evaluations. One correction
   from verification: the trigger should be the _second difference of
   frame deltas_, not the leader's exact acceleration, and it is a
   well-behaved heuristic rather than a safe bound.
4. **Two latent cycle defects surfaced.** A mutual-follow pair released
   from displacement settles at the wrong point on `main` today (32% of
   the displacement lost at dt = 33 ms — the pair agrees with itself
   perfectly, at the wrong place), and self-follow fling travel is
   frame-rate dependent (30 fps travels 29% less than 60 fps).
   Sub-stepping converges both like 1/K; nothing else on the table fixes
   them.

## 1. The ordering discovery

Kink (max second spatial difference, 512-link chain, demo config
`{ bounce: -1, duration: 265 }`, sinusoid A=200 f=0.75 Hz), real core:

| ordering                                               | dt=8 | dt=16 | dt=33     | dt=66     |
| ------------------------------------------------------ | ---- | ----- | --------- | --------- |
| default precision 2 (rest churn shuffles order)        | 8.98 | 7.55  | **23.66** | **36.84** |
| precision 12 (nothing rests, order stays leader-first) | 8.98 | 7.55  | 5.11      | 2.26      |

With ordering held topological, ZOH kink _decreases_ with dt — the
over-held target lets each link settle onto its leader and the chain
flattens. An LTI transfer-function analysis of the coupled chain predicts
exactly this and matches the library to 6 digits at small `wn*dt`. The
non-monotone RFC numbers (9 @ 16 ms, 60 @ 33 ms, 33 @ 66 ms) are the
frame-lag term (error scale `g*dt`, a full frame of leader travel per
lagged edge) gated by rest churn, which is non-monotone in dt: at small
dt nothing rests; at very large dt the tail rests bit-exactly and stays
down (`value !== target` suppresses churn); in between, churn dominates.
Instrumented at dt = 33 ms: 1499 stop events, order inversions in 329 of
364 frames. Teleport drives show the same 4.6-16x ordering gap.

Consequence: **coupling refinement is pointless before ordering is
pinned.** The RFC's "tick graph first" is right, for a stronger reason
than it gives.

Raw kink is also the wrong defect metric for accurate schemes: the true
continuous solution has intrinsic kink (~10.5 px for this drive — real
physics, not error), accurate schemes converge to it, and ordered ZOH at
large dt _undershoots_ it. The quantity that reads as wobble is the kink
of the error field (scheme minus RK4 truth); tables below use that.

## 2. First-order hold

### Exact form: one affine transform, zero new solvers

With the target ramping linearly at slope `g` over the frame, the
displacement ODE gains a constant forcing:

```
u'' + 2*zeta*wn*u' + wn^2*u = -2*zeta*wn*g
```

so the particular solution is the constant `u_ss = -(2*zeta/wn)*g`, and
`w = u - u_ss` is exactly homogeneous. The three existing regime solvers
apply verbatim to the shifted state: anchor `w(0) = u(0) - u_ss`,
`w'(0) = v(0) - g`; write back `u(dt) = w(dt) + u_ss` (the ramp endpoint
and the frame-end rebase coincide) and `v(dt) = w'(dt) + g`. Verified
against 200k-step RK4 to ~1e-13 in all three regimes; one 33 ms FOH frame
equals 33 chained 1 ms frames to ~1e-14 (exact for linear targets at any
step). `state.velocity` holds the ramp-relative `w'` only transiently
inside the tick; every observable read sees physical velocity.

Float hygiene forces the shape of the implementation: `(u - u_ss) + u_ss
!= u` in floats (unbounded relative error when `|u_ss| >> |u|`), so **the
ramp must be an argument of the frame tick, never persistent solver
state**. Then `g = 0` reduces bit-exactly to today's path (only
unobservable signed-zero flips — machine-verified with `Object.is`),
`tick(0)` stays today's exact identity, and FOH adds zero arithmetic to
every existing code path. Rest fixpoint, chain-settles-exactly, and the
dt = 0 sync re-anchor all survive bit-for-bit; see
https://github.com/tkofh/coily/blob/main/PRECISION.md.

### Error orders (verified constants)

- ZOH per-stage steady error: `+g*dt/2` — half a frame of leader travel,
  config-independent at leading order, a _lead_ (the follower chases the
  frame-end value).
- FOH residual: `a*dt^2/12` with `a` the leader's curvature — also
  config-independent at leading order.
- With K sub-steps: ZOH `~ g*(dt/K)/2` (first order), FOH `~
a*(dt/K)^2/12` (second order; doubling K divides the error by 4.000,
  measured K = 1..16).

L-infinity trajectory error vs RK4 truth, 8-link chain, sinusoid (px):

| scheme  | dt=8   | dt=16 | dt=33 | dt=66 |
| ------- | ------ | ----- | ----- | ----- |
| ZOH K=1 | 21.6   | 42.6  | 82.4  | 140.3 |
| FOH K=1 | 0.14   | 0.54  | 2.3   | 9.2   |
| FOH K=4 | 0.0085 | 0.034 | 0.14  | 0.57  |

Sub-stepped ZOH at K exactly equals ZOH at dt/K (pure coupling
refinement, as the RFC argues). FOH's curvature residual only bites at
66 ms; K = 2 recovers it. Error-field kink on the 64-link chain: FOH K=1
cuts injected wobble 8-143x below 66 ms.

### The three fences

1. **Sync writes stay steps.** FOH may ramp exactly the delta produced by
   the leader's own tick inside the current pass. `target =`, `value =`,
   `jumpTo`, and any other sync retarget remain steps at true event time
   through the existing `#setTarget` path — otherwise a teleport is
   smeared across the following frame (the outside world already saw the
   new value at event time) and double-counted. Pass-depth cannot
   discriminate (user handlers sync-write mid-pass); the call path can:
   only the follow-edge machinery observing the leader's tick arms a
   ramp. The tick graph provides exactly this seam.
2. **`arrival !== 1` followers fall back to step coupling.** Today's
   arrival crossings are closed-form zeros of the homogeneous solution;
   under FOH forcing the crossing equation `w(t) = -u_ss` is
   transcendental in every regime (underdamped: decaying oscillation =
   constant; critical: Lambert-W; overdamped: two-exponential sum).
   Options weighed: per-frame root-finding (re-introduces the per-frame
   bisection cost the lazy `timeRemaining` change just removed),
   redefining the crossing in shifted space (fires the event with `value
!= target` — breaks the arrival contract), or ZOH + error-controlled
   sub-stepping for these followers (crossings stay closed-form,
   "Arrival is exact" survives bit-for-bit, and each sub-step is a
   fixed-target tick so arrival needs no changes at all). The last wins;
   root-finding stays available later without architectural change.
3. **No FOH inside a cycle** — see section 4.

Non-spring leaders are safe: through a `mapSpring` (including non-smooth
maps — a clamp kink crossed mid-frame degrades FOH to O(dt) for that
frame but the chord's error never exceeds the worse one-sided hold, the
same class as today's ZOH), through `velocityOf`/`accelerationOf` (jumps
bridged by the chord, bounded by jump size), and through multi-root shape
maps — with one rule: compute the delta once per follower at its recouple
point from one stored previous mapped value, so partial per-root updates
never arm overlapping ramps.

## 3. Sub-stepping and the hybrid controller

The controller (corrected during verification):

```
E = |dT_n - dT_prev| / 8        one stored float per follow edge
K = clamp(ceil(sqrt(E / tol)), 1, K_max ~ 8)     FOH edges
K = clamp(ceil(|dT_n| / (2 * tol)), 1, K_max)    ZOH edges (arrival, cycles)
```

- `E` is the second difference of the leader's frame deltas — `~
a*dt^2/8` for smooth motion, saturating at the observed change for
  spikes, maps, and jumps. It beats the exact-acceleration estimator
  `|a_L|*dt^2/12` on every axis: the accel form is a valid a-priori bound
  but 38-67x over-conservative for stiff leaders (accel spikes decay on
  tau_fast ~ 3.4 ms, far inside a frame) and cannot exist for `mapSpring`
  leaders. **Correction:** `E` is a practical heuristic, not a safe
  bound — an underdamped leader whose damped period sits near the frame
  period can alias the second difference low. In the smooth/overdamped
  cases that matter it runs 2-8x conservative; the pathological aliasing
  case is exactly the kind of spring the SCC fence already routes to ZOH
  sub-stepping. Compute K from the _current_ frame's delta (after drive
  writes land); a one-frame-stale estimate measurably misses teleport
  frames (0.38 px -> 0.077 px after the fix).
- `tol`: `max(0.5 * 10^-precision, budget)` with `budget` ~ 0.1 value
  units as a system option. tol controls _local_ per-frame error; the
  measured global error runs 20-90x tol (accumulation over the ~47 ms
  slow time constant). It is a knob, not a guarantee.
- K must be uniform per connected component (shared frame subdivision);
  global `K = max` is correct and simplest, per-component K falls out of
  the tick graph. This _subsumes_ the RFC's stiffest-active-spring
  policy and is sharper: a stiff spring near rest gives E ~ 0, K = 1
  where the time-constant rule would sub-step for nothing.
- Flapping: measured K changes track drive phase, not noise (7-51
  changes per run); numerically harmless, cost-thrashy at worst.
  One-sided hysteresis (raise at `E > tol`, lower at `E < tol/4`) smooths
  it. Optional.
- Cost: ~5 flops + one sqrt per edge per frame — negligible against one
  solver tick (2 exp + trig). With the event split, notification stays
  1x regardless of K.

Hybrid, measured (tol = 0.005, 8-link chain): error flat at 0.03-0.45 px
across a 16x dt range (fixed FOH K=1 reaches 9.2 px at 66 ms); mean K
1.04-1.39 on quiet drives (a few percent over ZOH cost for ~two orders of
magnitude less error); rails at K=8 only for a sustained fast sinusoid at

> = 33 ms, which genuinely needs it. On the 512-chain teleport case it
> matched fixed K=8's error-field kink at 3.8x fewer evaluations. The
> co-simulation literature (FMI master algorithms, refs 13-14) has done
> error-controlled communication-step adaptation for a decade — the hybrid
> has prior art, it is not an exotic invention.

## 4. Cycles

- **ZOH cycles are unconditionally stable**: spectral radius < 1 for
  every `zeta in [0.02, 2]`, `wn*h in [0.05, 12]` (exactly 1, neutral, at
  zeta = 0). Sub-stepped ZOH converges to the continuous coupled dynamics
  at first order — the single stale back edge pins the order at O(dt/K).
- **FOH on any cycle edge can destabilize.** A mutual-follow 2-cycle with
  FOH on only the forward (fresh, tree!) edge reaches rho = 1.462 at
  zeta = 0.05 (`wn*h ~ 0.5..3.2`), 1.104 at zeta = 0.2, vanishing above
  zeta ~ 0.27. `bounce: 0.95` is zeta = 0.05 — real configs enter the
  band exactly when frames drop. Mechanism: FOH's `+g` velocity coupling
  is necessarily one step stale around a loop, and delayed velocity
  feedback is negative damping near the half-period. Open chains are
  provably safe (FOH per-stage gain < ZOH's < continuous resonant gain).
  **The safe rule is SCC membership, not tree/back-edge status: FOH only
  on edges between different SCCs; inside an SCC, ZOH plus
  error-controlled sub-stepping.**
- **The settling-bias defect (new).** On `main` today, a mutual pair
  released from A=100/B=0 settles together at 34.03 (dt = 33 ms) or 42.12
  (dt = 16 ms) instead of the true midpoint 50: the back-edge reader
  integrates whole steps against a stale leader and bleeds the pair's
  conserved mean. No rest test can see it. Sub-stepping converges it
  ~1/K. An _extrapolated-ramp_ back edge (`B_{n-1} -> 2*B_{n-1} -
B_{n-2}`) removed the bias exactly (final 50.0000 at every K and dt
  tested) and stayed stable for zeta >= 0.6 including a 2000 px/s fling —
  but the spectral sweep found extrapolated variants unstable at
  zeta <= 0.05, so it could only ever be a damping-gated refinement, and
  the delayed-ramp variant is strictly worse than plain ZOH (doubles the
  effective delay). Default: ZOH back edges.
- **Self-follow fling travel is frame-rate dependent today** (dt = 33 ms
  travels 29% less than dt = 16 ms; continuous limit `v0/(2*zeta*wn)`).
  Sub-stepping converges it ~1/K; FOH does not fix it (and self-follow is
  a 1-node SCC, so the fence excludes it anyway).

## 5. Tick graph: design conclusions

Full design in the investigation records; the decisions, each verified
against the code:

1. **Edges as friend-closure records.** `Spring.#follow` registers a
   FollowEdge record — follower `Motion`, leader `Motion`s, and a
   `recouple(h)` closure that carries the retarget semantics — with
   `MotionSet`; `#unsubLeader` unregisters it. Graph structure lives in
   the system, retarget semantics stay in `Spring`, and the emitter
   subscription survives as the sync-write conduit. (Beats a
   module-scoped symbol channel and beats moving follow ownership into
   the system, which inverts layering.)
2. **Leader resolution via two side tables**: the existing `RECIPES`
   registry extended to cover `velocityOf`/`accelerationOf` wrappers,
   plus a `MOTION_BACKING` WeakMap written by the `Spring`/
   `CompositeSpring` constructors. Roots with no entry are foreign
   user-authored sources (a supported contract — `linked-spring.spec.ts`
   pins it) and contribute no ordering constraint, staying on the
   emitter/sync path.
3. **Ordering: lazy full recompute, not incremental.** Dirty flag on
   structural change; Tarjan SCC + condensation topological order, ties
   broken by monotone creation id; recomputed at most once per pass,
   cached separately from the active `Set` (so rest/wake churn — the
   section 1 defect — cannot touch order). Pearce-Kelly is rejected:
   burst tail-first construction costs it O(n^2) against one O(n)
   recompute, it needs dynamic SCC maintenance to support coily's
   first-class cycles, and at ~10^3 nodes with rare rewiring the
   recompute is tens of microseconds, amortized to nothing.
4. **Cycle policy needs no back-edge bookkeeping.** Within an SCC,
   members tick in ascending creation id (stable across passes and
   churn, unlike DFS spanning order); a "back edge" is simply any
   intra-SCC edge whose leader has not ticked this sub-step — the
   recouple's live read of that leader _is_ the previous-sub-step value.
   Every pathological-suite contract survives; resting self-follow stays
   bit-exact via the existing exact retarget no-op guard.
5. **Event split: quiet sub-steps + one frame-end sweep.** Sub-steps run
   `Motion._advance(h)` with no events; a frame-end `_settleFrame` sweep
   in graph order emits `update` once and reconciles `stop`/`start`
   against `#running` (`start` still fires eagerly through the existing
   sync wake path). A motion that rests on an interior sub-step still
   delivers its final exact-target update before `stop` — closing a hole
   where a composite's dirty-mark would never run — and transient
   mid-frame rest becomes externally invisible, making semantics
   independent of the K the controller happens to choose. The
   "one update per frame" assertion at `linked-spring.spec.ts:221`
   holds by construction. Sync-write paths are bit-for-bit untouched.
6. **FOH and sub-stepping share one code path** (RFC open question:
   yes). `recouple(h)` is the seam: FOH is the ramp interpretation of
   the delta, sub-stepping is K calls at `h = dt/K`, plain ZOH is the
   step interpretation. K gates to 1 with no active coupling, leaving
   the entire existing suite bit-exact. FOH before the tick graph is
   possible but mis-times ramps on any out-of-order edge — and section 1
   shows ordering decays during normal operation, so it is not a real
   option.

## 6. Revised layering

1. **Tick graph** (ordering + edge records + event-split plumbing). Fixes
   the dominant measured defect by itself — the 33-66 ms explosion is
   mostly ordering — and is the substrate everything else stands on.
2. **Error-controlled sub-stepping** (ZOH, `K = ceil(|dT|*... /tol)`
   form). Unconditionally stable everywhere including cycles and
   arrival springs; fixes the cycle settling bias and self-follow
   frame-rate dependence ~1/K; handles lag spikes uniformly.
3. **FOH on acyclic passthrough edges** (inter-SCC, `arrival === 1`,
   tick-path deltas only), with the K formula switching to the sqrt
   form on those edges. Kills the remaining `g*dt/2` term at K = 1 —
   the big accuracy multiplier at zero marginal cost.
4. Optional refinements, in descending value: K hysteresis; per-component
   K; Hermite (velocity-aware) hold — leader endpoint velocities are
   free and polynomial forcing keeps a closed-form particular solution,
   extending the FOH argument unchanged while killing most of the
   curvature term; damping-gated extrapolated back edges.

The RFC's "FOH vs sub-stepping" choice dissolves: they are one mechanism
at different hold orders, the controller arbitrates per frame, and the
hybrid is both cheaper than fixed K and more accurate than either alone.

## 7. Recovered literature

Cluster 1 — the tick graph (glitch-free propagation):

1. Bainomugisha et al., _A Survey on Reactive Programming_ (ACM CSUR 2013) — frame-lag error is a _glitch_; glitch avoidance via
   topological re-evaluation is a taxonomy axis.
2. Cooper & Krishnamurthi, _Embedding Dynamic Dataflow in a Call-by-Value
   Language_ (FrTime, ESOP 2006) — the canonical implementation: a
   priority queue keyed on node _height_; its dynamic-reconfiguration
   section is the worked answer to runtime rewiring. The one to re-read.
3. milomg, _Super Charging Fine-Grained Reactive Performance_ — how
   MobX/Preact/Solid schedule updates so every node runs once after its
   dependencies; benchmarked on deep chains; the likely proximate source
   of the "topological tick" phrasing.
4. Lee & Messerschmitt, _Synchronous Data Flow_ (Proc. IEEE 1987) —
   static schedule vs run-time dispatch: the tick graph as SDF's
   compile-time/run-time split.
5. Kahn, _The Semantics of a Simple Language for Parallel Programming_
   (1974) — scheduling-independent determinism, the property "ordering
   is accidental" violates.
6. Berry, _The Constructive Semantics of Pure Esterel_ — the strict
   alternative on causal cycles; coily's permissive cycles force a
   back-edge policy instead of a causality analysis.
7. Pearce & Kelly, _A Dynamic Topological Sort Algorithm for DAGs_ (JEA 2007) — incremental order maintenance (evaluated and rejected here,
   but the reference for it).
8. Unity Manual, _Order of execution for event functions_ — the
   "one frame off" folklore; LateUpdate as a crude two-phase topo order.

Cluster 2 — coupling accuracy: 9. Fiedler, _Fix Your Timestep!_ — fixed-step + render interpolation as
the canonical alternative (rejected: complicates the isolated-spring
exactness story, but the RFC should say so). 10. _First-order hold_ (sampled-data control) — ZOH/FOH vocabulary and
error orders. 11. Gomes et al., _Co-simulation: A Survey_ (ACM CSUR 2018) — the
follower chain is a co-simulation; Jacobi vs Gauss-Seidel masters,
input extrapolation/interpolation orders. 12. Kübler & Schiehlen, _Two Methods of Simulator Coupling_ (2000) —
explicit coupling can destabilize monolithically-stable systems
(independently anticipated the FOH-on-cycles finding).
13-14. FMI co-simulation error analysis + _communication step size
control_ (Arnold et al.) — error-controlled macro-step adaptation:
the hybrid controller's direct prior art. 15. Busch, _Continuous approximation techniques for co-simulation
methods_ — smoothness class (C0 vs C1) of the coupling signal has
stability consequences; relevant to `velocityOf` of a follower
sampling FOH's per-frame velocity kinks.
16-18. Hochbruck & Ostermann, _Exponential Integrators_ (Acta Numerica
2010); Cox & Matthews ETD — coily's closed-form-plus-hold is an
exponential integrator; FOH is ETD2's hold order. 19. Lelarasmee et al., _Waveform Relaxation_ (1982) — iterating the same
window to convergence as the alternative to sub-stepping for cycles
(cheap here: closed-form re-evaluation, not re-integration). 20. JUCE `SmoothedValue` — audio's version of ramped targets (zipper
noise).

## 8. Corrections applied during verification

Adversarial verification upheld 33 of 37 load-bearing claims; the four
refutations, folded in above: (1) the estimator constant is not constant
(local error is nearer O(dt^3) at small dt; correlation is strong exactly
where errors matter, weak only where they are sub-pixel) — treat E as a
heuristic with an empirical ceiling, not a bound; (2) same, for the
"safe bound" phrasing of E_delta — an underdamped leader near the frame
period can alias it low; (3) a claimed exact never-rests-while-ramping
criterion `(1 + 2*zeta)*|g|/wn > restingMagnitude` is approximate, not
exact (the evidence script skipped `Motion.tick`'s per-frame rest check);
rest semantics themselves survive FOH unchanged; (4) the g = 0 bit-exact
reduction is real but _only_ under the ramp-as-tick-argument design — a
persistent-ramp implementation would leak `(u - u_ss) + u_ss` rounding
into paths that are exact today.

## Non-goals (unchanged from the RFC)

Nothing here is needed for the playground; the single-spring exactness
contract is untouched; point-collision ideas remain out of scope.

## 9. Implementation record (2026-07-18)

Everything above shipped, staged exactly as section 6 lays out: the
tick graph first, then error-controlled ZOH sub-stepping, then FOH on
passthrough edges — one controller arbitrating per frame through the
`recouple(h)` seam. Public surface: the ordering and frame-end-event
guarantees, the `couplingTolerance` system option/property (default
0.1 value units, floored per follower at `0.5 * 10^-precision`), and a
"Followed targets" section in PRECISION.md. Headline acceptance, each
regenerable from the probes beside this doc:

- The shipped core reproduces the validated controller model cell for
  cell at print precision (`s5-foh-core.ts` against the
  `s4-freshness.ts` tables), and its FOH K = 1 row matches section 2's
  table (0.1353/0.5375/2.3150/9.1842 across dt = 8..66 ms, sinusoid).
  The hybrid holds L-infinity flat: 0.13-0.37 at 8 links, 0.34-0.94 at
  64, across the whole dt range.
- The 512-link kink probe reads 10.58/10.51/10.35/10.16 across
  dt = 8..66 ms — flat at the intrinsic ~10.5 of section 1, where the
  RFC measured 9 -> 60 -> 33 — with zero order inversions and the
  default-precision column bit-identical to precision 12
  (`s1-kink-core.ts`, `04-kink-debug.mjs`).
- Section 4's latent defects are fixed: the mutual pair settles at
  47.95 at dt = 33 ms (was 34.03; true 50) and the self-follow fling's
  30-vs-60 fps travel gap fell from 28.1% to 2.5% (`s3-cycles.ts`
  holds the model baselines; the suite pins the core numbers). Cyclic
  trajectories are bit-identical with FOH present or absent — the SCC
  fence in diff form.
- Cost: the 64-chain bench runs +13% over the pre-coupling tree, ~6%
  of it the sub-steps themselves (a pinned-K = 1 bench case is the
  permanent control); quiet frames are bit-identical to single-step
  advancing. K_max is 8. Hysteresis was measured (16-36 K changes per
  run) and skipped: K is memoryless and a change costs nothing, so
  flapping's only cost is the K value the error law already prices.

The estimator that shipped is the manifold-gated kinematic bound, a
stage-1 probe decision (`s4-freshness.ts`): fresh terms engage only
when the leader sits off its quasi-steady tracking manifold,
`|x_L + (2*zeta/wn) * v_L| > 4 * |d1|` — near zero while tracking any
smooth target at any speed, `|x|` after a teleport, `(2*zeta/wn)*|v|`
after a fling. It matched a truth-fed oracle on every drive, config,
and dt cell at zero extra solver cost; stale-only history misses
target teleports by a frame, and gated closed-form peeks matched its
accuracy but never beat it. Per-edge state is three floats; sync jumps
ride the follower's own target trail. Derived sources (`mapSpring`)
escalate through their underlying leaders' manifold deviations — exact
for identity passthroughs, a slope ~1 heuristic through map code.

Future work, in descending value, deferred deliberately:

- Hermite (velocity-aware) hold: leader endpoint velocities are free
  and polynomial forcing keeps a closed-form particular solution —
  kills most of the curvature residual that makes 66 ms frames the
  hybrid's worst cell.
- Per-component K: falls out of the graph when wanted; the global max
  is correct, just occasionally over-eager when one hot component
  sub-steps a quiet one.
- Damping-gated extrapolated back edges: exact cycle settling for
  zeta >= 0.6, unstable below zeta ~ 0.05 (section 4), so gated-only.
- Per-frame root-finding for FOH arrival crossings: ZOH sub-stepping
  covers arrival springs today without touching the arrival contract.
- FMI-style reject-and-redo macro-steps: needs full state
  save/restore; the a-priori controller measured well enough not to
  pay for it.
