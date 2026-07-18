# Follower-coupling accuracy: a numerical treatment of FOH, sub-stepping, and their interactions

Extends the follower-coupling RFC (retired; see `investigation.md` beside this file). All claims are numbered (C1..C34).
Every numerical claim was verified against the library's own solvers
(`packages/coily/src/solver.ts`, imported directly) or the full library
(`src/index.ts`), by the scripts in this directory:

- `01-foh-verify.mjs` — FOH closed form vs RK4, bit-exactness, dt -> 0
- `02-zoh-ramp.mjs` — ZOH steady-ramp fixed point vs derivation
- `03-chain-kink.mjs` / `04-kink-debug.mjs` — chain kink vs dt, instrumented
- `05-foh-curvature.mjs` / `05b-underdamped-long.mjs` — FOH curvature residual, K-scaling
- `06-cycles.mjs` / `07-cycle-followups.mjs` / `dbg5.mjs` — cycle spectral radii
- `08-estimator.mjs` — sub-step controller estimator calibration
- `09-rest-edges.mjs` — rest boundary under ramps, dt = 0 rounding hazard

Conventions: `wn` = naturalFrequency (rad/s), `z` = dampingRatio,
`sigma = z*wn`, `wd = wn*sqrt(|1 - z^2|)`, `u = y - T` the displacement,
`rm = restingMagnitude = 0.5 * 10^-precision`. The core simulates in
seconds (`system.ts` divides ms by 1000); all `dt` below are seconds
unless marked ms. Demo config (`bounce: -1, duration: 265`): `z = 2`,
`wn = 79.01`, slow eigenvalue `21.2/s` (tau 47 ms), fast `294.9/s`
(tau 3.4 ms).

A modeling fact used throughout:

**C1.** The continuous-time model that today's discretization approximates
is the _damper-to-ground_ spring: `y'' + 2 z wn y' + wn^2 (y - T(t)) = 0`,
i.e. damping acts on absolute velocity `y'`, not on `y' - T'`. Proof: within
a frame the solver damps `state.velocity`, which equals `y'` because the
target is frozen; a retarget rebases position only and leaves velocity
untouched (`spring.ts` `#setTarget`), so in the `dt -> 0` limit `v` remains
`y'` across retargets. Consequently the steady lag behind a ramp of slope
`g` is `u_ss = -(2 z / wn) g` (substitute `y = T + c`, `T = g t`:
`2 z wn g + wn^2 c = 0`), and the per-stage transfer is
`H(s) = wn^2 / (s^2 + 2 z wn s + wn^2)` with `H(0) = 1`. FOH as analyzed
below preserves exactly this limit (verified in C4): it changes the
discretization, not the physical model.

---

## 1. FOH closed form (Q1)

Within one frame let the target ramp linearly: `T(t) = T0 + g t`,
`t in [0, dt]`, `g = (T1 - T0) / dt` with `T1` the leader's frame-end
value. In displacement space `u = y - T(t)`: `u' = y' - g`, `u'' = y''`,
so the spring equation `y'' + 2 z wn y' + wn^2 (y - T) = 0` becomes

```
u'' + 2 z wn u' + wn^2 u = -2 z wn g        (constant forcing)
```

**C2.** The candidate hypothesis is **verified, in all three regimes**.
Since `wn > 0` always (`tension > 0`, `mass > 0`), the particular solution
is the constant `u_ss = -(2 z / wn) g`, and `w := u - u_ss` satisfies the
homogeneous equation exactly (uniqueness of linear-ODE solutions;
`u_ss'' = u_ss' = 0` and `wn^2 u_ss = -2 z wn g`). The regime split lives
entirely in the homogeneous operator, so the _existing_ solvers apply
unchanged to `w`. The complete FOH frame is:

- anchor: `w(0) = u(0) - u_ss`, `w'(0) = u'(0) = v_phys(0) - g`
- propagate: today's closed form for the config's regime
  (under: `e^(-sigma t)(c1 cos wd t + c2 sin wd t)`; critical:
  `(c1 + c2 t) e^(-wn t)`; over:
  `e^(-sigma t)(c1 sinh wd t + c2 cosh wd t)/wd`, with the same
  `c1/c2`-from-state formulas as `solver.ts`, applied to the shifted state)
- write back: `u(dt) = w(dt) + u_ss` (this is already the displacement
  against the frame-end target `T1` — the rebase and the ramp endpoint
  coincide, so no separate `#setTarget` rebase is needed for tick-path
  deltas), and `v_phys(dt) = w'(dt) + g`.

Verification (`01-foh-verify.mjs`): implementing `fohFrame` literally as
"library solver on shifted state" matches an RK4 reference of the forced
ODE (200k steps) to `|du| <= 2e-13`, `|dv| <= 2e-11` across
`z in {0, 0.3, 0.999, 1, 2, 3.5}` including the demo config, and one
33 ms FOH frame equals 33 chained 1 ms FOH frames along the same ramp to
rounding (`~1e-14`) — FOH is exact for a linear target, any step size,
in every regime.

**C3.** `g -> 0` reduces **bit-exactly** to today's path. With `g = 0`
(the exact value produced by `T1 - T0 = 0`, which a resting leader
guarantees bit-for-bit via the rest fixpoint): `u_ss = -(2z/wn)*0 = -0`,
and IEEE 754 gives `x - (-0) = x` and `x - 0 = x` for every finite
`x != -0`, so anchors and writebacks are bit-identical. The only
perturbation in the entire pipeline is `u0 = -0` anchoring as `+0`
(`-0 - (-0) = +0`), which is unobservable: coily compares with `===`
(under which `-0 === 0`), takes `Math.abs`, and emits `target + position`
(`target + -0 === target + 0`). Verified exhaustively in
`01-foh-verify.mjs` (every case bit-identical via `Object.is`, including
signed-zero displacement and velocity). Nevertheless the implementation
should branch on "no tick-path delta this frame" rather than compute with
`g = 0` — it is faster and removes even the theoretical concern (see also
C24 for why the ramp must not be persistent solver state).

**C4.** `dt -> 0` is continuous: with the leader moving at finite speed,
`g` stays bounded (`g -> leader velocity`) and `u(dt) - u(0) =
(v0 - g) dt + O(dt^2)`, `v(dt) - v0 = O(dt)` (measured slopes match
analytic values in `01-foh-verify.mjs`). The `dt = 0` sync-re-anchor case
is _not_ the limit of this family — `g = dT/0` is undefined — and must
remain a plain homogeneous re-anchor (C24, C26).

**C5.** Meaning of `state.velocity` during an FOH frame: solver-internally
the velocity slot holds `w' = y' - g` (velocity relative to the ramp);
the frame-end writeback restores physical `y'`. Every externally
observable read — frame-boundary reads, and mid-pass reads by other
springs' retarget handlers, which always occur after the leader's own
writeback — sees physical velocity, so the public contract ("value units
per second") and the `acceleration` getter formula
`-(tension*x + damping*v)/mass` keep today's meaning at every observable
instant. The rest test also runs on `(u(dt), y'(dt))` — displacement
against the frame-end target plus physical velocity — which is the
correct pair (C22).

---

## 2. The ZOH error and how it composes (Q2)

### Per-stage error

Today's coupling (topological order) is an _end-sampled_ zero-order hold:
the follower rebases to the leader's frame-**end** value `T(t_{n+1})` and
then integrates the homogeneous form over the frame.

**C6.** Steady-ramp fixed point. With propagator `A(dt) = e^(J dt)`,
`J = [[0,1],[-wn^2,-2 z wn]]`, the frame map is
`(c, v) -> A(dt) (c - D, v)` with `c = y - T` at the frame boundary and
`D = g dt`. Its fixed point is `(c*, v*) = -(I - A)^(-1) A (D, 0)^T`,
and the expansion `(I - A)^(-1) = -(1/dt)(I - J dt/2 + J^2 dt^2/12 + ...) J^(-1)`
with `J^(-1)(D,0)^T = (-2zD/wn, D)^T`, `J(-2z/wn,1)^T = (1,0)^T`,
`J^2(-2z/wn,1)^T = (0,-wn^2)^T` gives

```
c* = -2 z g / wn  +  g dt / 2  + O(dt^3)
v* =  g (1 - wn^2 dt^2 / 12)  + O(dt^3)
```

The per-stage ZOH kinematic error is therefore **`+g dt / 2` in
position — half a frame of leader travel, to leading order independent of
config** — a half-frame _lead_ (the follower chases the endpoint of a move
the true target only completes at frame end). Verified against the real
library in `02-zoh-ramp.mjs`: measured `c*` matches to 6 digits at
`wn dt <= 0.4` and to 3% even at the demo config's `wn dt = 2.6`, with the
residual scaling as `dt^3`; the `wn^2 dt^2/12` velocity deficit matches
where the expansion is valid. Local (single-frame, from equal initial
state) errors, by variation of constants
`e(dt) = wn^2 int h(dt-s) dT(s) ds` with `dT(s) = T' (dt - s)`:
`e_pos = wn^2 T' dt^3/3`, `e_vel = wn^2 T' dt^2/2` — third/second order
locally, first order after steady-state accumulation, consistent with C6.

### Composition down a chain — and what actually caused the RFC numbers

For a uniformly translating chain the `g dt/2` error is _identical per
stage_ and cancels in the second spatial difference; the kink comes from
non-uniform motion. In frequency domain the discrete per-stage transfer is
`H_d(z) = z e1^T (zI - A)^(-1) b`, `b = (1 - A11, -A21)^T`, with
`H_d(1) = 1` exactly (no drift — consistent with the RFC's bit-exact
settling measurement), and steady sinusoidal kink
`max_k |H_d|^(k-1) |1 - H_d|^2 |y_head| = |1 - H_d|^2 |H_d| A` at link 1.

**C7.** For smooth (sinusoidal) driving, the pure within-frame ZOH error
**does not increase the kink as `dt` grows — it decreases it.** Computed
for the demo config at 1 Hz, A = 300 (`03-chain-kink.mjs`): the LTI kink
prediction falls monotonically 24.7 (4 ms) -> 22.7 (8 ms) -> 19.1 (16 ms)
-> 12.9 (33 ms) -> 5.7 (66 ms) -> 0.01 (200 ms), converging to the
_continuous physical_ kink 26.7 as `dt -> 0` and to 0 as `dt -> inf`
(each follower fully settles onto its leader within one frame; `H_d -> 1`;
the chain degenerates to a copier). The half-frame _lead_ of end-sampled
ZOH partially cancels the physical phase lag, which is why moderate `dt`
_reduces_ the fundamental-frequency kink. Note the RFC's own small-dt
numbers already show this direction: kink 10 at 8 ms > 9 at 16 ms.

**C8.** The simulated chain (real library, 96 links, leader-first
construction) matches the LTI prediction **exactly** at dt = 4, 8, 16,
25, 40, 200 ms — and explodes above it at 33, 47, 66, 133, 265 ms
(e.g. 22 vs 12.9 at 33 ms; 40.6 vs 9.2 at 47 ms; 419 vs 0.01 at 265 ms).
Instrumentation (`04-kink-debug.mjs`) shows the excess is caused by a
mechanism the RFC does not identify: **transient rests permanently destroy
the accidental topological order.** `MotionSet` deletes a motion on rest;
the next leader update re-adds it via `Spring.#setTarget ->
MotionSet.add`, and a JS `Set` re-inserts a deleted key _at the end_. From
then on that motion ticks _after_ its own follower: a permanent one-frame
lag edge in the middle of the chain (`motion-set.ts` iterates insertion
order; the pass marker deduplicates but never reorders). At dt = 33 ms the
run had 1499 stop events and update-order inversions in 329 of 364 frames.
The error scale of a lagged edge is a _full_ frame of leader motion
`g dt` (its ramp fixed point is `c* - g dt`), and the kink at a
normal/lagged boundary is of that size: at the RFC's measured 60 px kink
for dt = 33 ms this implies `g ~ 1800 px/s`, exactly the peak follower
speed of a 300 px, 1 Hz sweep through the demo config. Rest-snap churn
(links hovering at the resting threshold, snapping exactly onto their
targets while neighbors move) adds spatial noise and drives the
reshuffling.

**C9.** This explains the RFC's non-monotone measurements
(9 @ 16 ms, 60 @ 33 ms, 33 @ 66 ms): the smooth-drive floor is the
physical kink (~9 px for their motion); the dt-dependent excess is
lag-edge error (`~ g dt`) _gated by how much churn occurs_, and churn is
non-monotone in `dt` — it requires links to hover near the resting
threshold, which happens when per-stage attenuation puts part of the chain
in the flap band. At small `dt` (mild attenuation) nothing rests: LTI
exact. At very large `dt` the tail rests _exactly_ (snapped bit-equal to
targets, `#setTarget`'s `value !== target` guard then suppresses all
churn): LTI exact again (my dt = 200 ms run: 0 stop events, 0 inversions,
kink 0.10). In between, churn and lag edges dominate. The measured
"kink explodes in the 33–66 ms band" is therefore primarily an _ordering_
failure (the RFC's own frame-lag category), triggered by rest dynamics,
not the within-frame hold error — which strengthens the RFC's
"tick graph first" recommendation considerably: on `main`, ordering
degrades during perfectly normal operation, not just under exotic
construction orders or rewiring.

---

## 3. FOH residual for a curved leader, and sub-step composition (Q3)

**C10.** FOH replaces the target with its chord, so the per-frame forcing
error is the linear-interpolation error
`dT(s) = chord(s) - T(s) = -(T''(xi)/2) s (s - dt)`, giving local errors
(variation of constants, `h(tau) ~ tau`):
`e_pos(dt) = wn^2 T'' dt^4 / 24`, `e_vel(dt) = wn^2 T'' dt^3 / 12`.
Accumulated to steady state under sustained curvature `a = T''` (parabolic
target), `e_ss = (I - A)^(-1) (e_pos, e_vel)^T` expands to

```
FOH steady position error = a dt^2 / 12 + O(dt^3)
```

**independent of `z` and `wn` to leading order** (the same
config-independence as ZOH's `g dt / 2`). Verified in
`05-foh-curvature.mjs` / `05b`: measured/predicted ratio = 1.0000–1.0026
for `z in {0.3, 1}` and 1.002–1.031 for the demo config
(`wn dt` up to 2.6), after subtracting the exact continuous parabola lag
`y - T = -(2z/wn) T' - (1 - 4 z^2) a / wn^2`. (For `z = 0` there is no
decay, so no steady state — the transient rings forever; FOH is still
exact for the ramp component, cf. C2, and `u_ss = 0` since an undamped
spring tracks a ramp with zero lag.)

**C11.** Sub-step composition (piecewise-linear hold, K segments per
frame, leader re-sampled at the K interior points):

```
FOH + K sub-steps:  error = a (dt/K)^2 / 12
ZOH + K sub-steps:  error = g (dt/K) / 2   (+ O(a (dt/K)^2) cross term)
```

Verified: doubling K divides the FOH error by 4.000 and the ZOH error by
2.00 across K = 1..16, with the FOH constant `a dt^2/12` exact
(`05-foh-curvature.mjs`). Concretely, for a 300 px, 1 Hz motion at 60 fps
(`g_max = 1885 px/s`, `a_max = 11.8e3 px/s^2`): ZOH error 15.7 px, FOH
error 0.27 px — a ~57x reduction at K = 1; at 33 ms, 31 px vs 1.07 px
(~29x). The RFC's "FOH lowers the kink by a large factor but leaves an
O(dt^2) curvature residual" is confirmed with the constant `1/12`.

---

## 4. An error-controlled sub-step policy (Q4)

**C12.** Estimators. Two per-edge, per-frame estimators of the K = 1 FOH
residual, both verified safe (never under-predicting) in
`08-estimator.mjs` against a K = 256 reference on a worst-case leader
(demo spring retargeted 0 -> 300, maximal acceleration spike):

- `E_acc = |a_L| dt^2 / 12` with `a_L` the leader's exact acceleration
  `-(tension x + damping v)/mass` at frame start (the `Spring.acceleration`
  getter). Valid a-priori bound, but **grossly conservative for stiff
  leaders**: the accel spike decays on the fast time constant
  (3.4 ms for the demo), so instantaneous accel wildly over-states the
  _sustained_ curvature the residual actually integrates. Measured:
  E_acc = 43.5 px vs actual 1.15 px at 16.7 ms (38x); 67x at 33 ms.
  It also does not exist for `mapSpring` leaders (the map's second
  derivative is unknowable).
- `E_delta = |dT_n - dT_{n-1}| / 8` — the second difference of the
  followed value's frame deltas, i.e. the deviation of successive chords;
  for smooth targets `dT_n - dT_{n-1} = T'' dt^2 + O(dt^3)` so this is
  `~ a dt^2 / 8`, and for spiky or mapped or jumpy targets it _saturates
  at the observed value change_ instead of extrapolating a derivative.
  Costs one stored float per follow edge. Measured: 2.2x conservative on
  the stiff case, 2.5–7.7x on smooth cases — uniformly `<= E_acc` and far
  tighter exactly where E_acc fails.

Recommendation: **use `E_delta` as the controller input** (it is also the
only option for mapped, velocity, and multi-root sources, C28–C30), keep
`E_acc` as the documented a-priori bound tying the residual to config
quantities. One-frame staleness of either estimate is absorbed by the
safety margin and hysteresis.

**C13.** Controller. Since the residual scales as `1/K^2`
(C11): `K = clamp(ceil(sqrt(E / tol)), 1, K_max)` with `K_max ~ 8`
(bounding worst-frame cost under lag spikes; the ticker's `adjustedLag`
already caps `dt` at 33 ms by default). For the ZOH-substep path used
where FOH is excluded (arrival springs C20, cycle edges C33):
`K = clamp(ceil(|v_L| dt / (2 tol)), 1, K_max)` from C11's `1/K` law.

**C14.** Tolerance. Two defensible anchors:

- `tol = 10^-precision` (twice `restingMagnitude`): "coupling error below
  the configured resolution is not meaningful motion" — principled, uses
  the library's own contract, but over-provisions K for a smoothness
  concern (0.01 px errors in 16 ms of motion are far below perception):
  the worst-case demo frame would demand K = 16.
- a motion budget `tol ~ 0.1` value units (the kink observable is ~2x the
  per-stage error; 0.2 px spatial wobble is invisible): demo worst frame
  K = 4–5, ordinary frames K = 1.

Recommend the budget form with `max(0.5 * 10^-precision, budget)` as the
floor, exposed as one system-level option; per-edge `tol` uses the
follower's own `precision`. On an N-chain the per-stage errors add in the
worst case (`N tol` absolute path error) but the _kink_ stays per-stage
sized, and downstream acceleration decays geometrically, so per-edge
budgeting is the right unit; do not divide by chain depth.

**C15.** Flapping and hysteresis. The map `E -> K` is quantized, so E
hovering near a threshold flaps K between adjacent values — numerically
harmless (every K yields a consistent, bounded-error frame; the scheme is
not history-dependent), but it thrashes frame cost at ~2x the leader's
oscillation frequency for underdamped leaders whose `|a|` crosses the
threshold twice per period. A one-sided hysteresis fixes it at zero risk:
raise K immediately when `E > tol`, lower only when `E < tol/4`
(one K-step changes the residual by `((K-1)/K)^2`, so a factor-4 window
guarantees no oscillation from quantization alone). Not required for
correctness.

**C16.** Global vs per-component. `K` must be uniform within a connected
component of the tick-path follow graph (a shared frame subdivision is
what makes intermediate leader samples exist), but components are
independent; per-component K is strictly cheaper and falls out of the
tick graph's component decomposition. Global `K = max over edges` is
correct and simpler; start global, move the decision per-component when
the tick graph lands. Interaction with the RFC's stiffest-active-spring
sketch: the error controller _subsumes_ it and is sharper — a stiff spring
near rest produces `E ~ 0` and K = 1 where the time-constant policy would
sub-step; conversely under hard driving `E_delta` grows exactly when the
fast mode is being excited. The time-constant rule survives only as
intuition for why `K_max ~ dt / tau_fast` recovers the demo
(33 ms / 3.4 ms ~ 10).

**C17.** Cost. Per frame per active follow edge: one stored float, ~5
flops, one `sqrt`, one `ceil` — orders of magnitude below one solver tick
(2 `exp` + trig). The K decision is O(edges) once per frame; sub-stepping
itself multiplies solver work by K but, with the event split, notification
stays 1x (the RFC's crux, unchanged).

---

## 5. Arrival interaction (Q5)

**C18.** Under FOH forcing the crossing condition "value meets the
(moving) target", `u(t) = 0`, becomes `w(t) = -u_ss`, a _nonzero constant_
equated with the decaying homogeneous form: underdamped
`e^(-sigma t)(c1 cos wd t + c2 sin wd t) = -u_ss` (decaying oscillation vs
constant — no elementary inverse), critical `(c1 + c2 t) e^(-wn t) = -u_ss`
(Lambert-W, two branches, not in JS's math library), overdamped
`A e^(-l1 t) + B e^(-l2 t) = -u_ss` (no elementary form). Today's
closed-form zeros (`solver.ts` anchors, PRECISION.md "Arrival is exact")
exist precisely because the right side is 0.

**C19.** Options. (a) _Root-find each frame_: bracket by the extrema of
`w` (extrema times are closed-form — they solve the same trig/hyperbolic
structure as today's crossing equations), bisect each monotone segment as
`config.ts`'s `solveEntry` already does (~50–60 evaluations), taking the
first root in `(0, dt]`; must handle `t = 0` being a root whenever the
follower sits exactly on the moving target, and near-tangency
(double-root) grazing. Robust but: a per-frame, per-spring bisection is
exactly the cost profile the lazy-`timeRemaining` change just removed, and
the `t = 0`/tangency case law is genuinely fiddly. (b) _ZOH fallback for
`arrival != 1` springs_: crossings remain closed-form and the "Arrival is
exact" contract survives bit-for-bit; such springs keep the ZOH coupling
error, which the error-controlled ZOH sub-step path (C13) reduces as
`1/K` — and under sub-stepping each sub-step is a fixed-target tick, so
arrival needs _no changes at all_ (the RFC already noted sub-stepping
"handles arrival crossings uniformly"). (c) _Redefine the crossing in
shifted space_ (`w = 0`, i.e. `u = u_ss`): rejected — the event would fire
with `value != target`, the exact-zero write would land the value off the
target, and the velocity multiplier would apply at the wrong instant;
it breaks the public meaning of arrival.

**C20.** Recommendation: **(b)**. FOH applies to `arrival === 1`
followers only; `arrival != 1` followers use ZOH coupling and participate
in error-controlled sub-stepping (C13's `1/K` controller), which both
preserves the exactness contract and bounds their coupling error. Springs
with `arrival != 1` _following a moving leader_ are a rare, semantically
odd combination (arrival is about how motion ends at a target); paying the
per-frame root-find (a) for them is not justified, and (a) remains
available later without changing the architecture.

---

## 6. Rest and precision semantics under FOH (Q6)

**C21.** Leader at rest: rest snaps the leader exactly (`motion.ts` zeroes
state before the final update; PRECISION.md "Rest is a fixpoint"), so the
follower's final rebase sees the exact target and every subsequent frame
has _no tick-path delta at all_ (a resting leader emits no updates; even
its final delta produces `T1 - T0` exactly). With the "no delta => today's
path" branch of C3 the follower's settling is bit-for-bit today's
homogeneous path, and the chain-settles-exactly property survives
arbitrary depth. Even the arithmetic-with-`g = 0` path is bit-exact
(C3's signed-zero analysis, machine-verified).

**C22.** A follower tracking a steady ramp of slope `g` has FOH
steady state `u = u_ss = -2 z g / wn`, `v_phys = g`, so the rest test
(`state.ts`: `|x| + |v|/wn <= rm`) evaluates to

```
(1 + 2 z) |g| / wn  <=  rm
```

**It never rests while `|g| > wn rm / (1 + 2 z)`** — verified exactly at
the boundary in `09-rest-edges.mjs` (g at 0.9x boundary rests, 1.1x does
not; measured steady `u` and `v` match `u_ss` and `g` to 6 digits). For
the default precision and demo config that threshold is
`79 * 0.005 / 5 = 0.079` units/s — genuinely imperceptible creep. Below
it, the follower stair-steps: each frame it re-enters the set, ticks,
lands inside the threshold, and snaps exactly onto the frame-end target —
today's ZOH behavior for sub-threshold creep, unchanged, with no
start/stop event churn (`#syncStart` fires only when the written state is
outside the threshold). ZOH's corresponding steady rest measure differs
only by `O(g dt)` (`c* = u_ss + g dt/2`), so a `g` within `O(g dt)` of the
boundary can rest under one scheme and not the other, or drift across it —
but both sides of the flap are inside "value glued to target within rm",
already possible today, and invisible by the precision contract.

**C23.** `dt = 0` ticks (sync re-anchors: `#setTarget`'s
`tick(0, false)`, `value` writes' `tick(0)`) must remain plain
homogeneous re-anchors. They occur outside frame passes, where no ramp
exists; the FOH machinery must therefore scope the ramp to the frame
advance itself.

**C24.** This is not just tidiness — it is a rounding requirement: if the
ramp were persistent solver state, a `dt = 0` tick under an armed ramp
would re-anchor through `w = u - u_ss` and write back `w + u_ss`, and
`(u - u_ss) + u_ss != u` in floating point (verified:
`(0.1 - 3.3333333333333335) + 3.3333333333333335 = 0.10000000000000009`;
relative error unbounded when `|u_ss| >> |u|`, e.g.
`u = 1e-8, u_ss = 2.5` corrupts the 8th digit). PRECISION.md rule 1
(reads/state exact, no injected rounding) therefore _forces_ the design:
**the ramp is an argument of the frame tick — e.g.
`Motion.tick(dt, delta)` / `solver.tick(dt, g)` — never stored state**,
and `tick(0)` (no delta) is today's exact identity re-anchor. With that
shape, FOH adds zero arithmetic to every path that exists today (C3), and
the rest fixpoint, retarget round-trips, and `toBe` exactness tests are
untouched.

---

## 7. Discontinuities: the tick-path / sync-path split (Q7)

**C25.** Precise rule: **FOH may ramp exactly one thing — the delta in
the followed value produced by the leader's own `tick` inside the current
system pass** (`dT_tick = L_after_tick - L_before_tick`, a quantity the
leader's tick defines regardless of anything else that happens in the
pass). Every other target change is and must remain a step at its true
event time: user writes to the leader (`target =`, `value =`, `jumpTo`)
and any follower-side sync retarget flow through `#setTarget` outside the
frame tick, rebase displacement immediately, emit synchronously, and
re-anchor via `tick(0, false)` — the step semantics the emitter already
implements.

**C26.** What goes wrong if a teleport is naively ramped ("smearing"):
the outside world (Vue refs, user `onUpdate`, DOM writes) has already
observed the leader at its new value at the event time, while the
follower's coupling would pretend the leader traversed
`[old, new]` during the _next_ frame — the follower chases ghost
mid-frame values the leader never occupied at those times, visibly
trailing a teleport as a smear one frame long (and, with `arrival != 1`,
generating spurious mid-ramp crossings). There is also a double-count
hazard: the sync path already rebased the step; if the next frame's ramp
re-applies the same delta, the follower overshoots by the teleport size.
The discrimination cannot be "pass depth" (user handlers running inside a
pass can perform sync writes mid-pass): the only correct discriminator is
the _call path_ — ramps are armed exclusively by the follow-edge
machinery when it observes the leader's tick during graph traversal
(equivalently: `dT_tick` is computed by the leader's tick itself), never
by `#setTarget`. This is precisely the seam the RFC's tick graph
provides; in the event-driven world the same rule reads "the `#follow`
subscription handler may arm a ramp only for deltas the leader's tick
reported, and sync-originated updates arm nothing."

**C27.** With that rule, a teleport _during_ a frame sequence composes
correctly: the follower steps at the event (sync rebase, exact), and the
next frame ramps only the leader's subsequent tick motion. The lag-clamp
path (`ticker.ts` rewriting a >500 ms gap to 33 ms) needs no special
casing: it changes `dt`, not the delta bookkeeping.

---

## 8. Non-spring leaders (Q8)

**C28.** `mapSpring` (nonlinear, possibly non-smooth maps). FOH ramps the
chord of the _composite_ signal `T = f(L(t))` between its true frame
endpoints. For smooth `f`, `T'' = f''(L) L'^2 + f'(L) L''` — curvature the
exact-accel estimator cannot see (another reason for `E_delta`, C12).
For a kink in the map (abs/clamp) crossed mid-frame, the chord misses the
corner by up to `theta(1-theta) |m2 - m1| dt <= |m2 - m1| dt / 4` (`m_i`
the two time-slopes `f'(L±) L'`): FOH degrades to first order in `dt` at
corner frames. It remains bounded by the ZOH scale: pointwise
`chord(s) - T(s) = (1 - s/dt)(T(0) - T(s)) + (s/dt)(T(dt) - T(s))`, so
`|chord - T| <= max(|T(0) - T(s)|, |T(dt) - T(s)|)` — the FOH forcing
error never exceeds the worse of the two one-sided holds, for _any_
continuous target, kinked or not, hence never exceeds the frame
oscillation of `T` that also bounds today's ZOH error. FOH through maps
is safe; it just loses its `dt^2` advantage exactly at corner frames.

**C29.** `velocityOf` / `accelerationOf`. The follower ramps a velocity
(or acceleration) signal; within frames these are smooth (the leader's
closed form), so C10 applies with `T'' = leader jerk` (resp. snap) and
nothing is special. The signals _jump_ mid-frame at leader arrival
crossings (velocity scaled by the multiplier inside the leader's tick)
and at sync flings; a jump inside a frame is exactly the non-smooth case
of C28 — the chord bridges it, error bounded by the jump size, same class
as ZOH (which also cannot represent a mid-frame jump), no stability
hazard. `accelerationOf` additionally jumps at every leader _retarget_
(rebasing `x` moves `a = -(k x + c v)/m` discontinuously); tick-path
retargets land on frame boundaries where the sample sequence already
captures them. The follower's own state stays a well-defined spring
tracking a scalar signal throughout; only the estimator sees spikes, and
`E_delta` saturates rather than extrapolating them (C12).

**C30.** Multi-root shape maps. The follower still consumes _one scalar
target sequence_; a single per-frame chord is well defined however many
roots move. The hazard is consistency, not the ramp: in the event model a
multi-root map fires the follower's retarget once per root per pass, and
intermediate calls see _mixed_ frames (some roots ticked, some not).
Today that is harmless — each partial retarget is a rebase, no time
passes between them, and the last one (all roots ticked, given topological
order) is what the frame integrates against. Under FOH the same must
hold: the delta is `f(all roots at pass end) - f(all roots at pass
start)`, computed _once_ at the follower's recouple point from one stored
previous value per edge — never accumulated per-root (partial deltas
would arm overlapping ramps and double-count). The stored-previous-value
scheme (already required by `E_delta`) makes multi-root ordering a
non-issue; the tick graph guarantees the "all roots ticked before
recouple" precondition that insertion order only accidentally provides —
and, per C8, stops providing after the first transient rest.

---

## 9. Cycles (Q9)

Model: mutual followers A <-> B, same config, one designated back edge
(A reads B's previous-frame value), forward edge fresh (B reads A's
this-frame value) — exactly the RFC's spanning-order-plus-back-edge
policy. Shift invariance (adding a constant to both values commutes with
rebase and tick) gives an exact eigenvalue 1 on the common-drift mode
`(1, 0, 1, 0)`; all stability statements are about the reduced dynamics
`(y_A - y_B, v_A, v_B, [memory])`, whose spectral radius `rho` was
computed two independent ways (characteristic polynomial of the probed
frame map, and renormalized power iteration; they agree to 5 digits) in
`06-cycles.mjs` / `07-cycle-followups.mjs` / `dbg5.mjs`, with the frame
maps built from the _library's own solvers_.

**C31.** ZOH cycles are stable exactly as the RFC asserts: over
`z in [0.02, 2]`, `wn h in [0.05, 12]`, `rho < 1` always (max 0.999 at
`z = 0.02`, approaching the marginal continuous limit; the difference
mode obeys `d'' + 2 z wn d' + 2 wn^2 d = 0`, damped for `z > 0`), and
`rho = 1.00000` for `z = 0` (undamped cycles neutrally stable — never
rest, never blow up, matching today's documented behavior). Sub-stepped
ZOH only shrinks `h`, so it stays stable, and the within-frame
Gauss-Seidel story is quantitatively confirmed: the sub-stepped cycle
converges to the continuous coupled dynamics at exactly first order —
error ratio 2.00/2.01/2.02 per K-doubling, K = 1..32
(`07-cycle-followups.mjs` (d)); the single stale back edge pins the order
at `O(dt/K)` no matter what the other edges do.

**C32.** **FOH on a cycle destabilizes it — even when the FOH edge is
only the _forward_ (fresh, tree) edge and the back edge stays ZOH.**
Measured spectral radii (`fohF` variant): at `z = 0.05` the cycle is
exponentially unstable (`rho > 1`) for `wn h` from ~0.5 all the way to
~3.2, peaking at `rho = 1.462` near `wn h = 2.75`; at `z = 0.2`,
unstable band `wn h in [2.57, 3.04]`, peak 1.104; the instability
vanishes at `z* ~ 0.27` (peak rho 1.010 at z = 0.25, 0.959 at z = 0.28).
Direct iteration confirms: growth factor 1.46216/frame sustained over 60
frames while the same state under ZOH decays to 3.8e-7. FOH back-edge
variants (extrapolating the stale segment, or replaying it delayed) are
comparably or more unstable (peaks 1.63 / 1.49 at z = 0.02). Mechanism:
FOH adds a velocity-coupling path (the `+g` writeback and `u_ss` shift
feed the leader's frame-average velocity into the follower); around a
loop that signal is necessarily one (sub-)step stale, and delayed
velocity feedback acts as negative damping in a band around the
half-period `wn h ~ pi`. Note `bounce: 0.95` is `z = 0.05`: real configs
sit in the danger zone whenever a dropped frame puts `wn h` near the
band — the exact regime sub-stepping is meant to rescue.

**C33.** Open chains are safe: the per-stage discrete gain
`max_w |H_d^FOH|` is _smaller_ than ZOH's near resonance and below the
continuous resonant gain (z = 0.05, wn h = 2.75: FOH 4.96 vs ZOH 7.43 vs
continuous 9.91; z = 0.5: 1.00 vs 1.16 vs 1.15) — FOH cannot amplify
feed-forward chains beyond what the physics already does. The hazard is
strictly a feedback phenomenon. Therefore: **FOH only on edges that are
not part of any cycle — i.e. edges whose endpoints lie in different
strongly connected components of the follow graph; inside an SCC every
edge uses ZOH** (with error-controlled sub-stepping, which improves cycle
fidelity at `O(1/K)` per C31 and is unconditionally stable). "Tree edge
of the DFS spanning order" is _not_ a safe criterion — the destabilized
forward edge above is a tree edge; SCC membership is the correct test.
Sub-stepping also shrinks `wn h` per sub-step, actively exiting the
danger band — the two policies compose.

**C34.** Practical corollary for the RFC's layering: the event-split
sub-stepper needs no per-edge case analysis on cycles (uniformly stable,
uniformly convergent); FOH needs the SCC restriction, the arrival
restriction (C20), and the sync/tick discrimination (C25) — its
"smaller, self-contained option" label undersells the case law. If both
are built, the natural composition is: FOH on acyclic passthrough edges
(kills the `g dt/2` term at K = 1), error-controlled sub-stepping
globally (curvature, cycles, arrival springs, lag spikes), on top of the
tick graph that C8 shows is needed for the ordering guarantee _today_.

---

## Synthesis

1. The RFC's error decomposition is right, but the weights are wrong on
   `main`: for smooth driving, the within-frame ZOH term _shrinks_ the
   fundamental-frequency kink as `dt` grows (C7); the observed
   33–66 ms explosion is frame-lag error re-injected by rest-driven
   `Set`-order shuffling (C8–C9). The tick graph is therefore not merely
   foundational — it fixes the dominant measured defect by itself.
2. FOH is exactly the conjectured shifted-equilibrium reuse of the
   existing solvers (C2), costs nothing on today's paths (C3, C24), and
   removes the `g dt / 2` per-stage term leaving `T'' dt^2 / 12` (C6,
   C10) — but it must be fenced: tick-path deltas only (C25), no
   `arrival != 1` (C20), no SCC-internal edges (C32–C33).
3. Error-controlled sub-stepping with `K = ceil(sqrt(E_delta / tol))`,
   `E_delta = |dT_n - dT_{n-1}| / 8`, one stored float per edge, is
   cheap, safe (2–8x conservative), works for every source kind, and
   converges `1/K^2` under FOH, `1/K` under ZOH and on cycles
   (C11–C17, C31).
