// Probe library for follower-coupling accuracy measurements.
// All simulation in SECONDS (core sims in seconds; advance(ms) divides by 1000).

// ---------- physics ----------

export interface Phys {
  zeta: number
  wn: number
  sigma: number // zeta * wn
  wd: number // damped/hyperbolic frequency (0 at critical)
  restMag: number
}

export function makePhys(zeta: number, wn: number, restMag: number): Phys {
  const sigma = zeta * wn
  let wd = 0
  if (zeta < 1) wd = wn * Math.sqrt(1 - zeta ** 2)
  else if (zeta > 1) wd = wn * Math.sqrt(zeta ** 2 - 1)
  return { zeta, wn, sigma, wd, restMag }
}

// Homogeneous closed-form propagation of displacement (x0, v0) by t seconds.
// Arithmetic mirrors solver.ts per regime (anchor c1/c2 then evaluate).
export function prop(p: Phys, x0: number, v0: number, t: number, out: number[]): void {
  if (p.zeta < 1) {
    const c1 = x0
    const c2 = (v0 + p.sigma * x0) / p.wd
    const sin = Math.sin(p.wd * t)
    const cos = Math.cos(p.wd * t)
    const decay = Math.exp(-p.sigma * t)
    const decayVelocity = -p.sigma * decay
    const oscillation = c1 * cos + c2 * sin
    const oscillationVelocity = -c1 * p.wd * sin + c2 * p.wd * cos
    out[0] = decay * oscillation
    out[1] = decay * oscillationVelocity + decayVelocity * oscillation
    return
  }
  if (p.zeta === 1) {
    const c1 = x0
    const c2 = v0 + p.wn * x0
    const decay = Math.exp(-p.wn * t)
    const decayVelocity = -p.wn * decay
    const scale = c1 + c2 * t
    out[0] = scale * decay
    out[1] = c2 * decay + decayVelocity * scale
    return
  }
  const c1 = v0 + p.sigma * x0
  const c2 = x0 * p.wd
  const decay = Math.exp(-p.sigma * t)
  const decayVelocity = -p.sigma * decay
  const clamped = Math.min(p.wd * t, 300)
  const sinh = Math.sinh(clamped)
  const cosh = Math.cosh(clamped)
  const scale = c1 * sinh + c2 * cosh
  const scaleVelocity = c1 * p.wd * cosh + c2 * p.wd * sinh
  out[0] = (scale * decay) / p.wd
  out[1] = (scale * decayVelocity + scaleVelocity * decay) / p.wd
}

// ---------- simple chain probe (scheme comparisons) ----------

export interface Chain {
  n: number
  target: Float64Array
  x: Float64Array // displacement: value = target + x
  v: Float64Array
}

export function makeChain(n: number, value = 0): Chain {
  const c = { n, target: new Float64Array(n), x: new Float64Array(n), v: new Float64Array(n) }
  c.target.fill(value)
  return c
}

export function chainValue(c: Chain, i: number): number {
  return c.target[i]! + c.x[i]!
}

export function rebase(c: Chain, i: number, newTarget: number): void {
  if (newTarget === c.target[i]) return
  const current = c.target[i]! + c.x[i]!
  c.target[i] = newTarget
  c.x[i] = current - newTarget
}

function snap(p: Phys, c: Chain, i: number): void {
  if (Math.abs(c.x[i]!) + Math.abs(c.v[i]!) / p.wn <= p.restMag) {
    c.x[i] = 0
    c.v[i] = 0
  }
}

export type Mode = 'zoh' | 'foh'

const scratch: number[] = [0, 0]

// One frame: drive write, then K coupled sub-steps in leader-first order.
// Returns solver evaluations spent.
export function stepChain(
  p: Phys,
  c: Chain,
  driveValue: number,
  dtSec: number,
  mode: Mode,
  K: number,
  doSnap = true,
): number {
  rebase(c, 0, driveValue)
  const h = dtSec / K
  let evals = 0
  for (let s = 0; s < K; s++) {
    // head: target held for the whole frame (exact regardless of K)
    prop(p, c.x[0]!, c.v[0]!, h, scratch)
    c.x[0] = scratch[0]!
    c.v[0] = scratch[1]!
    evals++
    if (doSnap) snap(p, c, 0)
    for (let i = 1; i < c.n; i++) {
      const L1 = c.target[i - 1]! + c.x[i - 1]!
      if (mode === 'zoh') {
        rebase(c, i, L1)
        prop(p, c.x[i]!, c.v[i]!, h, scratch)
        c.x[i] = scratch[0]!
        c.v[i] = scratch[1]!
      } else {
        const L0 = c.target[i]!
        const g = (L1 - L0) / h
        const shift = ((2 * p.zeta) / p.wn) * g // -u_p; equilibrium shift is -(2*zeta/wn)*g
        prop(p, c.x[i]! + shift, c.v[i]! - g, h, scratch)
        c.target[i] = L1
        c.x[i] = scratch[0]! - shift
        c.v[i] = scratch[1]! + g
      }
      evals++
      if (doSnap) snap(p, c, i)
    }
  }
  return evals
}

// ---------- the shipped controller (decided in s4-freshness.ts) ----------
// Frame-start sub-step planning with manifold-gated kinematic freshness.
// Per-edge state is three floats. History (d1, d2) comes from the
// follower's target trail, which already contains sync jumps (they
// retarget the follower at event time, before the frame). Freshness
// comes from the leader's own state, gated on its deviation from the
// quasi-steady tracking manifold s = |x_L + (2*zeta/wn)*v_L| — near 0
// while tracking any smooth target at any speed (the ramp particular
// solution is x = -(2*zeta/wn)*v), |x| after a target teleport,
// (2*zeta/wn)*|v| after a fling. Chosen in s4-freshness.ts over
// stale-only (misses target teleports by a frame: Linf 4.0 vs 0.16 at
// dt=66) and over gated closed-form peeks (identical accuracy, but each
// peek costs a solver evaluation and the run-ahead gate misfires at
// small dt); matches the truth-fed oracle within a few percent on every
// drive/config/dt cell.

export const MANIFOLD_GATE = 4

export interface EdgeEstimator {
  prevValue: number
  d1: number
  d2: number
}

export function makeEstimators(n: number, value = 0): EdgeEstimator[] {
  const ests: EdgeEstimator[] = []
  for (let i = 0; i < n; i++) ests.push({ prevValue: value, d1: 0, d2: 0 })
  return ests
}

// One edge's sub-step demand for the coming frame, from frame-start
// information only: the follower's current target (the leader value as
// of the last recouple) and the leader's state. Updates the estimator's
// history in place — call exactly once per edge per frame. Unclamped;
// the caller takes the max over edges and clamps to [1, K_max].
export function edgeSubsteps(
  p: Phys,
  est: EdgeEstimator,
  targetNow: number,
  xL: number,
  vL: number,
  dtSec: number,
  law: 'foh' | 'zoh',
  tol: number,
): number {
  const d = targetNow - est.prevValue
  est.d2 = est.d1
  est.d1 = d
  est.prevValue = targetNow

  let dHat = Math.abs(est.d1)
  let E = Math.abs(est.d1 - est.d2) / 8
  if (Math.abs(xL + ((2 * p.zeta) / p.wn) * vL) > MANIFOLD_GATE * Math.abs(est.d1)) {
    const aL = -(p.wn * p.wn * xL + 2 * p.sigma * vL)
    dHat = Math.max(dHat, Math.abs(vL) * dtSec + 0.5 * Math.abs(aL) * dtSec * dtSec)
    E = Math.max(E, (Math.abs(aL) * dtSec * dtSec) / 8)
  }
  return law === 'foh' ? Math.ceil(Math.sqrt(E / tol)) : Math.ceil(dHat / (2 * tol))
}

// Frame K for an all-FOH chain: max edge demand, clamped to [1, maxK].
// ests[i] belongs to the edge whose follower is link i.
export function chainSubsteps(
  p: Phys,
  c: Chain,
  ests: EdgeEstimator[],
  dtSec: number,
  tol: number,
  maxK = 8,
): number {
  let K = 1
  for (let i = 1; i < c.n; i++) {
    const k = edgeSubsteps(p, ests[i]!, c.target[i]!, c.x[i - 1]!, c.v[i - 1]!, dtSec, 'foh', tol)
    if (k > K) K = k
  }
  return Math.min(maxK, K)
}

// ---------- core-mirror chain (validation against the real library) ----------
// Mirrors Motion/solver semantics: anchored constants, accumulated absolute
// time, lazy re-anchor after writes, rest snap, retarget guard. Overdamped
// and underdamped regimes (the validation configs).

interface MirrorLink {
  target: number
  x: number
  v: number
  c1: number
  c2: number
  t: number
  needsReset: boolean
}

export interface MirrorChain {
  p: Phys
  links: MirrorLink[]
}

export function makeMirrorChain(p: Phys, n: number, value = 0): MirrorChain {
  const links: MirrorLink[] = []
  for (let i = 0; i < n; i++) {
    links.push({ target: value, x: 0, v: 0, c1: 0, c2: 0, t: 0, needsReset: true })
  }
  return { p, links }
}

function mirrorAnchor(p: Phys, l: MirrorLink): void {
  l.t = 0
  if (p.zeta < 1) {
    l.c1 = l.x
    l.c2 = (l.v + p.sigma * l.x) / p.wd
  } else if (p.zeta === 1) {
    l.c1 = l.x
    l.c2 = l.v + p.wn * l.x
  } else {
    l.c1 = l.v + p.sigma * l.x
    l.c2 = l.x * p.wd
  }
}

function mirrorEvaluate(p: Phys, l: MirrorLink): void {
  if (p.zeta < 1) {
    const sin = Math.sin(p.wd * l.t)
    const cos = Math.cos(p.wd * l.t)
    const decay = Math.exp(-p.sigma * l.t)
    const decayVelocity = -p.sigma * decay
    const oscillation = l.c1 * cos + l.c2 * sin
    const oscillationVelocity = -l.c1 * p.wd * sin + l.c2 * p.wd * cos
    l.x = decay * oscillation
    l.v = decay * oscillationVelocity + decayVelocity * oscillation
  } else if (p.zeta === 1) {
    const decay = Math.exp(-p.wn * l.t)
    const decayVelocity = -p.wn * decay
    const scale = l.c1 + l.c2 * l.t
    l.x = scale * decay
    l.v = l.c2 * decay + decayVelocity * scale
  } else {
    const decay = Math.exp(-p.sigma * l.t)
    const decayVelocity = -p.sigma * decay
    const clamped = Math.min(p.wd * l.t, 300)
    const sinh = Math.sinh(clamped)
    const cosh = Math.cosh(clamped)
    const scale = l.c1 * sinh + l.c2 * cosh
    const scaleVelocity = l.c1 * p.wd * cosh + l.c2 * p.wd * sinh
    l.x = (scale * decay) / p.wd
    l.v = (scale * decayVelocity + scaleVelocity * decay) / p.wd
  }
}

// Motion.tick(dt, emit?) mirror: lazy re-anchor, advance absolute t, rest snap.
function mirrorTick(p: Phys, l: MirrorLink, dt: number): void {
  if (l.needsReset) {
    mirrorAnchor(p, l)
    l.needsReset = false
  }
  l.t += dt
  mirrorEvaluate(p, l)
  if (Math.abs(l.x) + Math.abs(l.v) / p.wn <= p.restMag) {
    l.x = 0
    l.v = 0
    l.needsReset = true
  }
}

// Spring.#setTarget mirror: guard, rebase, re-anchor via tick(0, false).
function mirrorRetarget(p: Phys, l: MirrorLink, newTarget: number): void {
  if (newTarget === l.target) return
  const current = l.target + l.x
  l.target = newTarget
  l.x = current - newTarget
  l.needsReset = true
  mirrorTick(p, l, 0)
}

// One frame of the real system: drive write outside the tick, then
// MotionSet pass in insertion (leader-first) order, each leader's end-of-tick
// update retargeting its follower before the follower ticks.
export function stepMirrorChain(m: MirrorChain, driveValue: number, dtSec: number): void {
  const { p, links } = m
  mirrorRetarget(p, links[0]!, driveValue)
  for (let i = 0; i < links.length; i++) {
    mirrorTick(p, links[i]!, dtSec)
    if (i + 1 < links.length) {
      mirrorRetarget(p, links[i + 1]!, links[i]!.target + links[i]!.x)
    }
  }
}

export function mirrorValue(m: MirrorChain, i: number): number {
  return m.links[i]!.target + m.links[i]!.x
}

// ---------- RK4 truth (continuous coupling, piecewise-constant head target) ----------

export interface Truth {
  frames: number // recorded frame boundaries (frame ends), 1..frames
  values: Float64Array[] // [frameIndex][link], frameIndex 0 = t=0 initial
  vels: Float64Array[]
}

// Integrates the continuously-coupled n-link chain: head chases drive value
// (held per frame, matching the discrete drive), each follower chases its
// leader's continuous position. Records state at every frame boundary.
// headJump pins the head AT the drive value each frame (jumpTo semantics:
// value and target land together, velocity clears) instead of chasing it.
export function rk4Chain(
  p: Phys,
  n: number,
  drive: (tMs: number) => number,
  dtMs: number,
  simMs: number,
  hSec = 1e-5,
  headJump = false,
): Truth {
  const y = new Float64Array(n)
  const w = new Float64Array(n)
  const k1y = new Float64Array(n)
  const k1w = new Float64Array(n)
  const k2y = new Float64Array(n)
  const k2w = new Float64Array(n)
  const k3y = new Float64Array(n)
  const k3w = new Float64Array(n)
  const k4y = new Float64Array(n)
  const k4w = new Float64Array(n)
  const ty = new Float64Array(n)
  const tw = new Float64Array(n)
  const wn2 = p.wn * p.wn
  const twoSigma = 2 * p.sigma

  let T = 0 // head target, held per frame

  const deriv = (yy: Float64Array, ww: Float64Array, oy: Float64Array, ow: Float64Array) => {
    oy[0] = ww[0]!
    ow[0] = -twoSigma * ww[0]! - wn2 * (yy[0]! - T)
    for (let i = 1; i < n; i++) {
      oy[i] = ww[i]!
      ow[i] = -twoSigma * ww[i]! - wn2 * (yy[i]! - yy[i - 1]!)
    }
  }

  const stepsPerFrame = Math.round(dtMs / 1000 / hSec)
  const frames = Math.floor(simMs / dtMs)
  const values: Float64Array[] = [new Float64Array(n)]
  const vels: Float64Array[] = [new Float64Array(n)]

  for (let f = 0; f < frames; f++) {
    T = drive(f * dtMs)
    if (headJump) {
      y[0] = T
      w[0] = 0
    }
    for (let s = 0; s < stepsPerFrame; s++) {
      deriv(y, w, k1y, k1w)
      for (let i = 0; i < n; i++) {
        ty[i] = y[i]! + 0.5 * hSec * k1y[i]!
        tw[i] = w[i]! + 0.5 * hSec * k1w[i]!
      }
      deriv(ty, tw, k2y, k2w)
      for (let i = 0; i < n; i++) {
        ty[i] = y[i]! + 0.5 * hSec * k2y[i]!
        tw[i] = w[i]! + 0.5 * hSec * k2w[i]!
      }
      deriv(ty, tw, k3y, k3w)
      for (let i = 0; i < n; i++) {
        ty[i] = y[i]! + hSec * k3y[i]!
        tw[i] = w[i]! + hSec * k3w[i]!
      }
      deriv(ty, tw, k4y, k4w)
      for (let i = 0; i < n; i++) {
        y[i] = y[i]! + (hSec / 6) * (k1y[i]! + 2 * k2y[i]! + 2 * k3y[i]! + k4y[i]!)
        w[i] = w[i]! + (hSec / 6) * (k1w[i]! + 2 * k2w[i]! + 2 * k3w[i]! + k4w[i]!)
      }
    }
    values.push(Float64Array.from(y))
    vels.push(Float64Array.from(w))
  }
  return { frames, values, vels }
}

// ---------- drives ----------

export function sinDrive(amplitude: number, freqHz: number): (tMs: number) => number {
  const w = 2 * Math.PI * freqHz
  return (tMs) => amplitude * Math.sin((w * tMs) / 1000)
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Random teleports: target jumps to uniform [-A, A] at random intervals in
// [minMs, maxMs]; held between jumps. Deterministic for a given seed.
export function teleportDrive(
  seed: number,
  amplitude: number,
  minMs: number,
  maxMs: number,
  simMs: number,
): (tMs: number) => number {
  const rand = mulberry32(seed)
  const times: number[] = []
  const targets: number[] = []
  let t = 0
  let value = 0
  times.push(0)
  targets.push(0)
  while (t < simMs) {
    t += minMs + rand() * (maxMs - minMs)
    value = (rand() * 2 - 1) * amplitude
    times.push(t)
    targets.push(value)
  }
  return (tMs) => {
    // linear scan is fine at these sizes; drives are called once per frame
    let i = times.length - 1
    while (times[i]! > tMs) i--
    return targets[i]!
  }
}

// ---------- metrics ----------

// max over interior links of |y[i-1] - 2*y[i] + y[i+1]|
export function kinkOf(values: ArrayLike<number>): number {
  let m = 0
  for (let i = 1; i < values.length - 1; i++) {
    const k = Math.abs(values[i - 1]! - 2 * values[i]! + values[i + 1]!)
    if (k > m) m = k
  }
  return m
}

export function pearson(a: number[], b: number[]): number {
  const n = a.length
  let ma = 0
  let mb = 0
  for (let i = 0; i < n; i++) {
    ma += a[i]!
    mb += b[i]!
  }
  ma /= n
  mb /= n
  let sab = 0
  let saa = 0
  let sbb = 0
  for (let i = 0; i < n; i++) {
    const da = a[i]! - ma
    const db = b[i]! - mb
    sab += da * db
    saa += da * da
    sbb += db * db
  }
  return sab / Math.sqrt(saa * sbb)
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

export function fmt(x: number, digits = 4): string {
  if (x === 0) return '0'
  const ax = Math.abs(x)
  if (ax >= 0.001 && ax < 10000) return x.toFixed(digits)
  return x.toExponential(2)
}
