// Stage 3: cycles. Two mutual followers (A<->B) and a self-follow.
// Frame map: [A, B] in insertion order; forward edge B<-A same-(sub)step,
// back edge A<-B reads the previous (sub-)step (Gauss-Seidel).
import { defineSpring } from '../../packages/coily/src/index.ts'
import { makePhys, prop, fmt, type Phys } from './problib.ts'

const out: number[] = [0, 0]

// advance value/velocity (y, v) by h against a held target L
function advHold(p: Phys, y: number, v: number, L: number, h: number): [number, number] {
  prop(p, y - L, v, h, out)
  return [L + out[0]!, out[1]!]
}

// advance (y, v) by h against a ramp L0 -> L1
function advRamp(
  p: Phys,
  y: number,
  v: number,
  L0: number,
  L1: number,
  h: number,
): [number, number] {
  const g = (L1 - L0) / h
  const shift = ((2 * p.zeta) / p.wn) * g
  prop(p, y - L0 + shift, v - g, h, out)
  return [L1 + (out[0]! - shift), out[1]! + g]
}

type BackEdge = 'zoh' | 'delayed-ramp' | 'extrap-ramp'
type FwdEdge = 'zoh' | 'foh'

interface PairState {
  yA: number
  vA: number
  TA: number // A's target: B's value as of the previous (sub-)step
  prevTA: number // one older, for back-edge ramps
  yB: number
  vB: number
  TB: number // B's target: A's value as of B's last rebase
}

function pairSubStep(p: Phys, s: PairState, h: number, fwd: FwdEdge, back: BackEdge): void {
  // A advances against its (stale) view of B
  if (back === 'zoh') {
    ;[s.yA, s.vA] = advHold(p, s.yA, s.vA, s.TA, h)
  } else if (back === 'delayed-ramp') {
    ;[s.yA, s.vA] = advRamp(p, s.yA, s.vA, s.prevTA, s.TA, h)
  } else {
    ;[s.yA, s.vA] = advRamp(p, s.yA, s.vA, s.TA, s.TA + (s.TA - s.prevTA), h)
  }
  // B advances against A's fresh value (same sub-step)
  if (fwd === 'zoh') {
    ;[s.yB, s.vB] = advHold(p, s.yB, s.vB, s.yA, h)
  } else {
    ;[s.yB, s.vB] = advRamp(p, s.yB, s.vB, s.TB, s.yA, h)
  }
  s.TB = s.yA
  // back-edge refresh: A re-reads B at sub-step end (previous-step read next time)
  s.prevTA = s.TA
  s.TA = s.yB
}

function pairFrame(
  p: Phys,
  s: PairState,
  dtSec: number,
  K: number,
  fwd: FwdEdge,
  back: BackEdge,
): void {
  const h = dtSec / K
  for (let k = 0; k < K; k++) pairSubStep(p, s, h, fwd, back)
}

// RK4 truth for the continuously-coupled pair (K -> infinity limit)
function rk4Pair(
  p: Phys,
  y0: number[],
  simSec: number,
  h = 1e-5,
): { ts: number[]; ys: number[][] } {
  let [yA, vA, yB, vB] = y0 as [number, number, number, number]
  const wn2 = p.wn * p.wn
  const ts = 2 * p.sigma
  const steps = Math.round(simSec / h)
  const res: number[][] = [[yA, vA, yB, vB]]
  const f = (s: number[]) => [
    s[1]!,
    -ts * s[1]! - wn2 * (s[0]! - s[2]!),
    s[3]!,
    -ts * s[3]! - wn2 * (s[2]! - s[0]!),
  ]
  let st = [yA, vA, yB, vB]
  for (let i = 0; i < steps; i++) {
    const k1 = f(st)
    const k2 = f(st.map((x, j) => x + 0.5 * h * k1[j]!))
    const k3 = f(st.map((x, j) => x + 0.5 * h * k2[j]!))
    const k4 = f(st.map((x, j) => x + h * k3[j]!))
    st = st.map((x, j) => x + (h / 6) * (k1[j]! + 2 * k2[j]! + 2 * k3[j]! + k4[j]!))
    res.push(st)
  }
  return { ts: res.map((_, i) => i * h), ys: res }
}

const configs = [
  {
    name: 'demo overdamped (zeta=2, wn=79.0)',
    def: defineSpring({ bounce: -1, duration: 265, precision: 12 }),
  },
  {
    name: 'bouncy (zeta=0.6, wn=20.3)',
    def: defineSpring({ bounce: 0.4, duration: 500, precision: 12 }),
  },
]

const SIMS = 3 // seconds
for (const { name, def } of configs) {
  const p = makePhys(def.dampingRatio, def.naturalFrequency, def.restingMagnitude)
  console.log(`\n=== mutual followers, config: ${name} ===`)
  console.log('A displaced to 100 and released (A: value 100 target 0; B: value 0 target 100)')

  // truth
  const truth = rk4Pair(p, [100, 0, 0, 0], SIMS)
  const tEnd = truth.ys[truth.ys.length - 1]!
  console.log(
    `RK4 truth (continuous coupling): A(3s)=${fmt(tEnd[0]!)} B(3s)=${fmt(tEnd[2]!)}  (settles to common value)`,
  )

  for (const dtMs of [16, 33]) {
    const dtSec = dtMs / 1000
    const frames = Math.floor((SIMS * 1000) / dtMs)
    console.log(` dt=${dtMs}ms, ZOH both edges:`)
    for (const K of [1, 2, 4, 8]) {
      const s: PairState = { yA: 100, vA: 0, TA: 0, prevTA: 0, yB: 0, vB: 0, TB: 100 }
      let linf = 0
      let maxAbs = 0
      for (let f = 0; f < frames; f++) {
        pairFrame(p, s, dtSec, K, 'zoh', 'zoh')
        const stepIdx = Math.round(((f + 1) * dtMs) / 1000 / 1e-5)
        const tv = truth.ys[stepIdx]!
        linf = Math.max(linf, Math.abs(s.yA - tv[0]!), Math.abs(s.yB - tv[2]!))
        maxAbs = Math.max(maxAbs, Math.abs(s.yA), Math.abs(s.yB))
      }
      console.log(
        `  K=${K}  Linf vs truth=${fmt(linf).padStart(9)}  final A=${fmt(s.yA)} B=${fmt(s.yB)}  |A-B|=${fmt(Math.abs(s.yA - s.yB))}  max|value|=${fmt(maxAbs, 1)}`,
      )
    }

    // per-frame fixed-point residual: F_K vs F_512 from the same frame-start state
    console.log(
      `  per-frame fixed-point residual |F_K - F_512| (max / median over ${frames} frames):`,
    )
    {
      const s: PairState = { yA: 100, vA: 0, TA: 0, prevTA: 0, yB: 0, vB: 0, TB: 100 }
      const residualsByK = new Map<number, number[]>([
        [1, []],
        [2, []],
        [4, []],
        [8, []],
      ])
      for (let f = 0; f < frames; f++) {
        const ref = { ...s }
        pairFrame(p, ref, dtSec, 512, 'zoh', 'zoh')
        for (const K of [1, 2, 4, 8]) {
          const trial = { ...s }
          pairFrame(p, trial, dtSec, K, 'zoh', 'zoh')
          residualsByK
            .get(K)!
            .push(Math.max(Math.abs(trial.yA - ref.yA), Math.abs(trial.yB - ref.yB)))
        }
        pairFrame(p, s, dtSec, 1, 'zoh', 'zoh') // trajectory continues at K=1
      }
      for (const K of [1, 2, 4, 8]) {
        const rs = residualsByK.get(K)!.sort((a, b) => a - b)
        const max = rs[rs.length - 1]!
        const med = rs[rs.length >> 1]!
        console.log(`   K=${K}: max=${fmt(max)}  median=${fmt(med)}`)
      }
    }

    // FOH forward edge + back-edge policies
    console.log(`  FOH forward edge, back-edge policy sweep (K=1 and K=4):`)
    for (const back of ['zoh', 'delayed-ramp', 'extrap-ramp'] as BackEdge[]) {
      for (const K of [1, 4]) {
        const s: PairState = { yA: 100, vA: 0, TA: 0, prevTA: 0, yB: 0, vB: 0, TB: 100 }
        let linf = 0
        let maxAbs = 0
        for (let f = 0; f < frames; f++) {
          pairFrame(p, s, dtSec, K, 'foh', back)
          const stepIdx = Math.round(((f + 1) * dtMs) / 1000 / 1e-5)
          const tv = truth.ys[stepIdx]!
          linf = Math.max(linf, Math.abs(s.yA - tv[0]!), Math.abs(s.yB - tv[2]!))
          maxAbs = Math.max(maxAbs, Math.abs(s.yA), Math.abs(s.yB))
        }
        const stable = Number.isFinite(s.yA) && maxAbs < 1000
        console.log(
          `   back=${back.padEnd(12)} K=${K}  Linf=${fmt(linf).padStart(9)}  max|value|=${fmt(maxAbs, 1).padStart(8)}  final A=${fmt(s.yA)} B=${fmt(s.yB)}  ${stable ? '' : 'UNSTABLE'}`,
        )
      }
    }
  }

  // fling stress: A flung with v = 2000 from rest at 0 (both at 0)
  console.log(' fling stress (A,B at 0; A velocity 2000), dt=33ms:')
  {
    const dtSec = 0.033
    const frames = Math.round(3000 / 33)
    const truthF = rk4Pair(p, [0, 2000, 0, 0], SIMS)
    for (const [fwd, back, K] of [
      ['zoh', 'zoh', 1],
      ['zoh', 'zoh', 8],
      ['foh', 'zoh', 1],
      ['foh', 'delayed-ramp', 1],
      ['foh', 'extrap-ramp', 1],
      ['foh', 'extrap-ramp', 8],
    ] as Array<[FwdEdge, BackEdge, number]>) {
      const s: PairState = { yA: 0, vA: 2000, TA: 0, prevTA: 0, yB: 0, vB: 0, TB: 0 }
      let linf = 0
      let maxAbs = 0
      for (let f = 0; f < frames; f++) {
        pairFrame(p, s, dtSec, K, fwd, back)
        const stepIdx = Math.min(Math.round(((f + 1) * 33) / 1000 / 1e-5), truthF.ys.length - 1)
        const tv = truthF.ys[stepIdx]!
        linf = Math.max(linf, Math.abs(s.yA - tv[0]!), Math.abs(s.yB - tv[2]!))
        maxAbs = Math.max(maxAbs, Math.abs(s.yA), Math.abs(s.yB))
      }
      console.log(
        `  fwd=${fwd} back=${back.padEnd(12)} K=${K}  Linf=${fmt(linf).padStart(9)}  max|value|=${fmt(maxAbs, 1)}  final A=${fmt(s.yA)} B=${fmt(s.yB)}`,
      )
    }
  }
}

// ---------- self-follow ----------
console.log('\n=== self-follow (A follows A), demo config, fling v0=1000 from value 0 ===')
{
  const def = defineSpring({ bounce: -1, duration: 265, precision: 12 })
  const p = makePhys(def.dampingRatio, def.naturalFrequency, def.restingMagnitude)
  const contLimit = 1000 / (2 * p.zeta * p.wn)
  console.log(`continuous limit of the drift: v0 / (2*zeta*wn) = ${fmt(contLimit)}`)
  for (const dtMs of [16, 33]) {
    for (const K of [1, 2, 4, 8, 64]) {
      let y = 0
      let v = 1000
      const h = dtMs / 1000 / K
      const frames = Math.round(3000 / dtMs)
      for (let f = 0; f < frames; f++) {
        for (let k = 0; k < K; k++) {
          prop(p, 0, v, h, out) // x rebased to 0 at every (sub-)step end
          y += out[0]!
          v = out[1]!
        }
      }
      console.log(`  dt=${dtMs}ms K=${String(K).padStart(2)}: drift=${fmt(y)}  final v=${fmt(v)}`)
    }
  }
  // FOH self-follow: ramp from previous own value to current own value
  console.log(' FOH self-follow (ramp = own previous delta), dt=33ms K=1:')
  {
    let y = 0
    let v = 1000
    let prevY = 0
    const h = 0.033
    for (let f = 0; f < Math.round(3000 / 33); f++) {
      const [ny, nv] = advRamp(p, y, v, prevY, y + (y - prevY), h)
      prevY = y
      y = ny
      v = nv
    }
    console.log(
      `  drift=${fmt(y)}  final v=${fmt(v)}  ${Number.isFinite(y) && Math.abs(y) < 1e6 ? 'stable' : 'UNSTABLE'}`,
    )
  }
}
