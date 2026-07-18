// Stage 2 supplement: 64-link chain vs RK4 truth.
// - kink of the TRUE solution (is raw kink a defect metric at all?)
// - kink of the ERROR FIELD per scheme (the actual wobble injected)
// - L-infinity error at depth 64 (does per-stage error accumulate?)
import { defineSpring } from '../../packages/coily/src/index.ts'
import {
  makePhys,
  makeChain,
  makeEstimators,
  stepChain,
  chainValue,
  chainSubsteps,
  rebase,
  rk4Chain,
  sinDrive,
  teleportDrive,
  kinkOf,
  fmt,
} from './problib.ts'

const config = defineSpring({ bounce: -1, duration: 265, precision: 12 })
const p = makePhys(config.dampingRatio, config.naturalFrequency, config.restingMagnitude)

const N = 64
const SIM = 5000
const WARM = 1000
const dts = [8, 16, 33, 66]
const TOL = 0.005

const schemes: Array<{ name: string; mode: 'zoh' | 'foh'; K: number | 'hybrid' }> = [
  { name: 'ZOH K=1', mode: 'zoh', K: 1 },
  { name: 'ZOH K=4', mode: 'zoh', K: 4 },
  { name: 'FOH K=1', mode: 'foh', K: 1 },
  { name: 'FOH K=4', mode: 'foh', K: 4 },
  { name: 'HYBRID', mode: 'foh', K: 'hybrid' },
]

for (const [dname, mk] of [
  ['sinusoid A=200 f=0.75Hz', () => sinDrive(200, 0.75)],
  ['teleports seed 42', () => teleportDrive(42, 200, 300, 1200, SIM)],
] as const) {
  console.log(`\n64-link chain, drive: ${dname} (5s, warmup 1s, precision 12)`)
  for (const dt of dts) {
    const t0 = performance.now()
    const drive = mk()
    const truth = rk4Chain(p, N, drive, dt, SIM, 1e-5)
    // kink of the true solution at frame boundaries
    let truthKink = 0
    for (let f = 0; f < truth.frames; f++) {
      if ((f + 1) * dt >= WARM) {
        const k = kinkOf(truth.values[f + 1]!)
        if (k > truthKink) truthKink = k
      }
    }
    console.log(
      ` dt=${String(dt).padStart(2)}ms  kink(RK4 truth) = ${fmt(truthKink, 2)}   (truth ${(performance.now() - t0).toFixed(0)}ms wall)`,
    )
    for (const s of schemes) {
      const c = makeChain(N)
      const ests = makeEstimators(N)
      const err = new Float64Array(N)
      let kinkErr = 0
      let linf = 0
      let argmax = -1
      let evals = 0
      let sumK = 0
      for (let f = 0; f < truth.frames; f++) {
        const d = drive(f * dt)
        let k: number
        if (s.K === 'hybrid') {
          // Drive writes land before the plan pass, as in the core.
          rebase(c, 0, d)
          k = chainSubsteps(p, c, ests, dt / 1000, TOL)
        } else {
          k = s.K
        }
        sumK += k
        evals += stepChain(p, c, d, dt / 1000, s.mode, k, true)
        const tv = truth.values[f + 1]!
        for (let i = 0; i < N; i++) {
          err[i] = chainValue(c, i) - tv[i]!
          const ae = Math.abs(err[i]!)
          if (ae > linf) {
            linf = ae
            argmax = i
          }
        }
        if ((f + 1) * dt >= WARM) {
          const ke = kinkOf(err)
          if (ke > kinkErr) kinkErr = ke
        }
      }
      console.log(
        `   ${s.name.padEnd(8)} kink(error field)=${fmt(kinkErr).padStart(10)}   Linf=${fmt(linf).padStart(10)} @link${argmax}   meanK=${(sumK / truth.frames).toFixed(2)}  evals=${evals}`,
      )
    }
  }
}
