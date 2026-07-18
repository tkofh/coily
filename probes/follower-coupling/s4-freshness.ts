// Hybrid-plan stage 1: pick the controller's estimator freshness scheme.
//
// Models the real core's information pattern, which the earlier probes did
// not: K is chosen ONCE per frame, at frame start (after drive/sync writes
// land, before any motion advances), from per-edge stored floats
// (prevValue, d1, d2) plus frame-start spring state. The closed-form
// probes could read the leader's frame-end value a priori; the core
// cannot, so each candidate below is a frame-start substitute for the
// corrected estimator's "current frame delta":
//
//   stale     history only: dHat = |d1|, E = |d1 - d2| / 8. Sync jumps
//             are already inside d1 (they retarget the follower at event
//             time), so this is free and sync-aware but one frame late on
//             tick-path spikes.
//   kin       stale, plus a kinematic bound from the leader's state:
//             dHat >= |v_L|*dt + 0.5*|a_L|*dt^2, E >= |a_L|*dt^2 / 8.
//             Free reads; the rejected-accel-estimator comparison point.
//   peek      stale, plus a single-level closed-form evaluation of the
//             leader at t + dt (target held), gated on the leader's state
//             running ahead of its recent deltas:
//             |x_L| + |v_L|*dt > 4*|d1|. Costs one solver evaluation per
//             fired gate.
//   peek-all  peek with no gate (accuracy/cost ceiling of the family).
//   oracle    the true current-frame delta, read from the RK4 truth
//             (unimplementable; upper bound on freshness).
//
// Laws (investigation section 3, corrected): FOH edges
// K = ceil(sqrt(E / tol)); ZOH edges K = ceil(dHat / (2 * tol));
// K = max over edges, clamped to [1, 8]. tol = 0.1 (shipping default:
// max(0.5 * 10^-precision, budget) with default precision 2 and
// budget 0.1).
//
// Scored on: teleport-frame miss (max error within 2 frames of a drive
// write), overall Linf vs RK4 truth, mean K and K flaps (idle
// over-stepping), and solver evaluations including peeks (cost).
import { defineSpring } from '../../packages/coily/src/index.ts'
import {
  type Phys,
  type Truth,
  chainValue,
  fmt,
  makeChain,
  makePhys,
  prop,
  rebase,
  rk4Chain,
  sinDrive,
  stepChain,
  teleportDrive,
} from './problib.ts'

const N = 8
const SIM = 5000
const DTS = [8, 16, 33, 66]
const TOL = 0.1
const K_MAX = 8
const GATE = 4

// kin-m and peek-m gate their freshness term on the leader's deviation
// from the quasi-steady tracking manifold, s = |x_L + (2*zeta/wn)*v_L|:
// a leader tracking any smooth target at any speed sits near s = 0 (the
// ramp particular solution is x = -(2*zeta/wn)*v), while a teleport
// leaves s = |x| and a fling s = (2*zeta/wn)*|v0|. The run-ahead gate
// |x| + |v|*dt > G*|d1| conflates steady lag with shock and misfires at
// small dt.
type Candidate = 'K1' | 'K8' | 'stale' | 'kin' | 'kin-m' | 'peek' | 'peek-m' | 'peek-all' | 'oracle'
const CANDIDATES: Candidate[] = [
  'K1',
  'K8',
  'stale',
  'kin',
  'kin-m',
  'peek',
  'peek-m',
  'peek-all',
  'oracle',
]

interface Est {
  prevValue: number
  d1: number
  d2: number
}

function makeEsts(n: number, prevValue: number): Est[] {
  const ests: Est[] = []
  for (let i = 0; i < n; i++) ests.push({ prevValue, d1: 0, d2: 0 })
  return ests
}

const out2: number[] = [0, 0]

interface Counters {
  peeks: number
}

// One edge's K under `law`, from frame-start info only. Updates the
// estimator's history from the follower's current target (which already
// includes any sync retargets — they land through the emitter at event
// time), then augments with the candidate's freshness term.
function edgeK(
  cand: Candidate,
  p: Phys,
  est: Est,
  targetNow: number,
  xL: number,
  vL: number,
  dtSec: number,
  law: 'foh' | 'zoh',
  counters: Counters,
  oracleDelta: number | null,
): number {
  const d = targetNow - est.prevValue
  est.d2 = est.d1
  est.d1 = d
  est.prevValue = targetNow

  let dHat = Math.abs(est.d1)
  let E = Math.abs(est.d1 - est.d2) / 8

  if (cand === 'kin' || cand === 'kin-m') {
    const fire =
      cand === 'kin' || Math.abs(xL + ((2 * p.zeta) / p.wn) * vL) > GATE * Math.abs(est.d1)
    if (fire) {
      const aL = -(p.wn * p.wn * xL + 2 * p.sigma * vL)
      dHat = Math.max(dHat, Math.abs(vL) * dtSec + 0.5 * Math.abs(aL) * dtSec * dtSec)
      E = Math.max(E, (Math.abs(aL) * dtSec * dtSec) / 8)
    }
  } else if (cand === 'peek' || cand === 'peek-m' || cand === 'peek-all') {
    const fire =
      cand === 'peek-all'
        ? true
        : cand === 'peek-m'
          ? Math.abs(xL + ((2 * p.zeta) / p.wn) * vL) > GATE * Math.abs(est.d1)
          : Math.abs(xL) + Math.abs(vL) * dtSec > GATE * Math.abs(est.d1)
    if (fire) {
      counters.peeks++
      prop(p, xL, vL, dtSec, out2)
      const dF = out2[0]! - xL
      dHat = Math.max(dHat, Math.abs(dF))
      E = Math.max(E, Math.abs(dF - est.d1) / 8)
    }
  } else if (cand === 'oracle' && oracleDelta !== null) {
    dHat = Math.max(dHat, Math.abs(oracleDelta))
    E = Math.max(E, Math.abs(oracleDelta - est.d1) / 8)
  }

  return law === 'foh' ? Math.ceil(Math.sqrt(E / TOL)) : Math.ceil(dHat / (2 * TOL))
}

// ---------- chains (FOH law: the shipping scheme on acyclic edges) ----------

interface ChainResult {
  linf: number
  spikeErr: number
  meanK: number
  flaps: number
  evals: number
  peeks: number
}

function runChain(
  cand: Candidate,
  p: Phys,
  drive: (tMs: number) => number,
  kind: 'target' | 'jump',
  dtMs: number,
  truth: Truth,
): ChainResult {
  const dtSec = dtMs / 1000
  const c = makeChain(N)
  const ests = makeEsts(N, 0)
  const counters: Counters = { peeks: 0 }
  let linf = 0
  let spikeErr = 0
  let sumK = 0
  let flaps = 0
  let prevK = 1
  let evals = 0
  let prevDrive = drive(0)
  let lastWrite = -Infinity

  for (let f = 0; f < truth.frames; f++) {
    const dv = drive(f * dtMs)
    if (dv !== prevDrive || f === 0) lastWrite = f
    prevDrive = dv

    // Drive writes land before the plan pass, as in the core.
    rebase(c, 0, dv)
    if (kind === 'jump') {
      c.x[0] = 0
      c.v[0] = 0
      // jumpTo emits synchronously: the follower's target steps at event
      // time, outside the tick.
      rebase(c, 1, chainValue(c, 0))
    }

    let K = 1
    if (cand === 'K8') {
      K = 8
    } else if (cand !== 'K1') {
      for (let i = 1; i < N; i++) {
        const j = i - 1
        const oracleDelta =
          cand === 'oracle' ? truth.values[f + 1]![j]! - truth.values[f]![j]! : null
        const k = edgeK(
          cand,
          p,
          ests[i]!,
          c.target[i]!,
          c.x[j]!,
          c.v[j]!,
          dtSec,
          'foh',
          counters,
          oracleDelta,
        )
        if (k > K) K = k
      }
      if (K > K_MAX) K = K_MAX
    }
    sumK += K
    if (K !== prevK) flaps++
    prevK = K

    evals += stepChain(p, c, dv, dtSec, 'foh', K, true)

    const tv = truth.values[f + 1]!
    for (let i = 0; i < N; i++) {
      const e = Math.abs(chainValue(c, i) - tv[i]!)
      if (e > linf) linf = e
      if (f - lastWrite <= 2 && e > spikeErr) spikeErr = e
    }
  }

  return {
    linf,
    spikeErr,
    meanK: sumK / truth.frames,
    flaps,
    evals: evals + counters.peeks,
    peeks: counters.peeks,
  }
}

// ---------- mutual pair (ZOH law: the shipping scheme inside an SCC) ----------

interface PairState {
  yA: number
  vA: number
  TA: number
  yB: number
  vB: number
  TB: number
}

function pairFrame(p: Phys, s: PairState, dtSec: number, K: number): void {
  const h = dtSec / K
  for (let k = 0; k < K; k++) {
    // A advances against its stale view of B (the back edge)
    prop(p, s.yA - s.TA, s.vA, h, out2)
    s.yA = s.TA + out2[0]!
    s.vA = out2[1]!
    // B advances against A's fresh value (same sub-step)
    prop(p, s.yB - s.yA, s.vB, h, out2)
    s.yB = s.yA + out2[0]!
    s.vB = out2[1]!
    s.TB = s.yA
    s.TA = s.yB
  }
}

function rk4Pair(p: Phys, y0: number[], simSec: number, h = 1e-5): number[][] {
  const wn2 = p.wn * p.wn
  const ts = 2 * p.sigma
  const steps = Math.round(simSec / h)
  const f = (s: number[]) => [
    s[1]!,
    -ts * s[1]! - wn2 * (s[0]! - s[2]!),
    s[3]!,
    -ts * s[3]! - wn2 * (s[2]! - s[0]!),
  ]
  let st = [...y0]
  const res: number[][] = [[...st]]
  for (let i = 0; i < steps; i++) {
    const k1 = f(st)
    const k2 = f(st.map((x, j) => x + 0.5 * h * k1[j]!))
    const k3 = f(st.map((x, j) => x + 0.5 * h * k2[j]!))
    const k4 = f(st.map((x, j) => x + h * k3[j]!))
    st = st.map((x, j) => x + (h / 6) * (k1[j]! + 2 * k2[j]! + 2 * k3[j]! + k4[j]!))
    res.push(st)
  }
  return res
}

interface PairResult {
  finalA: number
  finalB: number
  linf: number
  meanK: number
  evals: number
  peeks: number
}

function runPair(cand: Candidate, p: Phys, dtMs: number, truthYs: number[][]): PairResult {
  const dtSec = dtMs / 1000
  const frames = Math.floor((SIM / dtMs) * 1) // SIM ms at dtMs
  const s: PairState = { yA: 100, vA: 0, TA: 0, yB: 0, vB: 0, TB: 100 }
  const estA: Est = { prevValue: 0, d1: 0, d2: 0 } // A's edge: leader B
  const estB: Est = { prevValue: 100, d1: 0, d2: 0 } // B's edge: leader A
  const counters: Counters = { peeks: 0 }
  let linf = 0
  let sumK = 0
  let evals = 0

  for (let f = 0; f < frames; f++) {
    let K = 1
    if (cand === 'K8') {
      K = 8
    } else if (cand !== 'K1') {
      const stepIdx = (i: number) =>
        Math.min(Math.round((i * dtMs) / 1000 / 1e-5), truthYs.length - 1)
      const t0 = truthYs[stepIdx(f)]!
      const t1 = truthYs[stepIdx(f + 1)]!
      const kA = edgeK(
        cand,
        p,
        estA,
        s.TA,
        s.yB - s.TB,
        s.vB,
        dtSec,
        'zoh',
        counters,
        cand === 'oracle' ? t1[2]! - t0[2]! : null,
      )
      const kB = edgeK(
        cand,
        p,
        estB,
        s.TB,
        s.yA - s.TA,
        s.vA,
        dtSec,
        'zoh',
        counters,
        cand === 'oracle' ? t1[0]! - t0[0]! : null,
      )
      K = Math.min(K_MAX, Math.max(1, kA, kB))
    }
    sumK += K
    pairFrame(p, s, dtSec, K)
    evals += 2 * K

    const tv = truthYs[Math.min(Math.round(((f + 1) * dtMs) / 1000 / 1e-5), truthYs.length - 1)]!
    linf = Math.max(linf, Math.abs(s.yA - tv[0]!), Math.abs(s.yB - tv[2]!))
  }

  return {
    finalA: s.yA,
    finalB: s.yB,
    linf,
    meanK: sumK / frames,
    evals: evals + counters.peeks,
    peeks: counters.peeks,
  }
}

// ---------- self-follow fling (ZOH law, 1-node SCC) ----------

interface SelfResult {
  drift: number
  meanK: number
  evals: number
  peeks: number
}

function runSelf(cand: Candidate, p: Phys, dtMs: number, v0: number): SelfResult {
  const dtSec = dtMs / 1000
  const frames = Math.round(3000 / dtMs)
  let y = 0
  let v = v0
  const est: Est = { prevValue: 0, d1: 0, d2: 0 }
  const counters: Counters = { peeks: 0 }
  let sumK = 0
  let evals = 0
  const sigma2 = 2 * p.sigma

  for (let f = 0; f < frames; f++) {
    let K = 1
    if (cand === 'K8') {
      K = 8
    } else if (cand !== 'K1') {
      // Continuous self-follow is pure velocity decay: y(t) = (v0 / 2sigma) * (1 - exp(-2sigma t))
      const t0 = f * dtSec
      const oracleDelta =
        cand === 'oracle'
          ? (v0 / sigma2) * (Math.exp(-sigma2 * t0) - Math.exp(-sigma2 * (t0 + dtSec)))
          : null
      // Displacement is 0 at every frame start (target rebased to own value
      // at each sub-step end); velocity carries.
      K = Math.min(
        K_MAX,
        Math.max(1, edgeK(cand, p, est, y, 0, v, dtSec, 'zoh', counters, oracleDelta)),
      )
    }
    sumK += K
    const h = dtSec / K
    for (let k = 0; k < K; k++) {
      prop(p, 0, v, h, out2)
      y += out2[0]!
      v = out2[1]!
      evals++
    }
  }

  return { drift: y, meanK: sumK / frames, evals: evals + counters.peeks, peeks: counters.peeks }
}

// ---------- run ----------

const demoDef = defineSpring({ bounce: -1, duration: 265, precision: 12 })
const bouncyDef = defineSpring({ bounce: 0.4, duration: 500, precision: 12 })
const demo = makePhys(demoDef.dampingRatio, demoDef.naturalFrequency, demoDef.restingMagnitude)
const bouncy = makePhys(
  bouncyDef.dampingRatio,
  bouncyDef.naturalFrequency,
  bouncyDef.restingMagnitude,
)

console.log(`Freshness candidates, tol=${TOL} (shipping default), K_max=${K_MAX}, gate=${GATE}`)
console.log(`Chain: ${N} links, FOH law. spike = max err within 2 frames of a write.`)

interface Scenario {
  name: string
  mk: () => (tMs: number) => number
  kind: 'target' | 'jump'
}

const scenarios: Scenario[] = [
  {
    name: 'sinusoid A=200 f=0.75Hz (target writes)',
    mk: () => sinDrive(200, 0.75),
    kind: 'target',
  },
  {
    name: 'teleports seed 42 (target writes)',
    mk: () => teleportDrive(42, 200, 300, 1200, SIM),
    kind: 'target',
  },
  {
    name: 'teleports seed 42 (jumpTo: head pinned, sync step to link 1)',
    mk: () => teleportDrive(42, 200, 300, 1200, SIM),
    kind: 'jump',
  },
  {
    name: 'sinusoid A=200 f=0.75Hz (jumpTo: kinematic head)',
    mk: () => sinDrive(200, 0.75),
    kind: 'jump',
  },
]

const chainRuns: Array<{ label: string; p: Phys; dts: number[]; scenarios: Scenario[] }> = [
  { label: 'demo overdamped (zeta=2, wn=79)', p: demo, dts: DTS, scenarios },
  // Underdamped sanity: the manifold-gate analysis is overdamped-centric,
  // and low zeta is where the estimator could alias or the gate misread
  // ring-down as steady tracking.
  {
    label: 'bouncy (zeta=0.6, wn=20.3)',
    p: bouncy,
    dts: [33, 66],
    scenarios: scenarios.slice(0, 2),
  },
]

for (const run of chainRuns) {
  console.log(`\n#### chain config: ${run.label} ####`)
  for (const sc of run.scenarios) {
    console.log(`\n== ${sc.name} ==`)
    for (const dtMs of run.dts) {
      const t0 = performance.now()
      const drive = sc.mk()
      const truth = rk4Chain(run.p, N, drive, dtMs, SIM, 1e-5, sc.kind === 'jump')
      console.log(
        ` dt=${String(dtMs).padStart(2)}ms  (truth ${(performance.now() - t0).toFixed(0)}ms)`,
      )
      for (const cand of CANDIDATES) {
        const r = runChain(cand, run.p, sc.mk(), sc.kind, dtMs, truth)
        const spike =
          sc.kind === 'target' && sc.name.startsWith('sinusoid')
            ? '        —'
            : fmt(r.spikeErr).padStart(9)
        console.log(
          `   ${cand.padEnd(8)} Linf=${fmt(r.linf).padStart(9)}  spike=${spike}  meanK=${r.meanK.toFixed(2)}  flaps=${String(r.flaps).padStart(3)}  evals=${String(r.evals).padStart(6)}${r.peeks ? ` (peeks ${r.peeks})` : ''}`,
        )
      }
    }
  }
}

for (const [label, p] of [
  ['demo overdamped', demo],
  ['bouncy', bouncy],
] as const) {
  console.log(`\n== mutual pair released A=100/B=0, ${label} (ZOH law; truth settles at 50) ==`)
  for (const dtMs of [16, 33]) {
    const truthYs = rk4Pair(p, [100, 0, 0, 0], SIM / 1000)
    console.log(` dt=${dtMs}ms`)
    for (const cand of CANDIDATES) {
      const r = runPair(cand, p, dtMs, truthYs)
      console.log(
        `   ${cand.padEnd(8)} final A=${fmt(r.finalA)} B=${fmt(r.finalB)}  Linf=${fmt(r.linf).padStart(9)}  meanK=${r.meanK.toFixed(2)}  evals=${String(r.evals).padStart(5)}${r.peeks ? ` (peeks ${r.peeks})` : ''}`,
      )
    }
  }
}

for (const [label, p] of [
  ['demo overdamped', demo],
  ['bouncy', bouncy],
] as const) {
  console.log(
    `\n== self-follow fling v0=1000, ${label} (ZOH law; continuous drift limit ${fmt(1000 / (2 * p.sigma))}) ==`,
  )
  for (const dtMs of [16, 33]) {
    console.log(` dt=${dtMs}ms`)
    for (const cand of CANDIDATES) {
      const r = runSelf(cand, p, dtMs, 1000)
      console.log(
        `   ${cand.padEnd(8)} drift=${fmt(r.drift)}  meanK=${r.meanK.toFixed(2)}  evals=${String(r.evals).padStart(5)}${r.peeks ? ` (peeks ${r.peeks})` : ''}`,
      )
    }
  }
}
