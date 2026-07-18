// Hybrid-plan stage 4 acceptance: FOH through the real core.
//
// The investigation's 8-link table (section 2) was measured on the
// closed-form chain model; this re-measures it through the shipped
// library — springs, follow edges, controller, ramps — against the same
// RK4 truth. Expected magnitudes (L-infinity, sinusoid): ZOH K=1 was
// 21.6/42.6/82.4/140.3 across dt = 8/16/33/66 ms; FOH K=1
// 0.14/0.54/2.3/9.2. `couplingTolerance: 1e9` pins K = 1 (ramps still
// arm), so that row IS FOH K=1; the default row is the full hybrid.
//
// The last section drives a non-smooth (clamped) map across its kink:
// FOH degrades to the one-sided hold there, bounded, no blowup —
// measured against a finely-stepped core reference.
import {
  type SpringSystem,
  createSpringSystem,
  defineSpring,
  mapSpring,
} from '../../packages/coily/src/index.ts'
import type { Spring } from '../../packages/coily/src/spring.ts'
import { fmt, makePhys, rk4Chain, sinDrive, teleportDrive } from './problib.ts'

const config = defineSpring({ bounce: -1, duration: 265, precision: 12 })
const p = makePhys(config.dampingRatio, config.naturalFrequency, config.restingMagnitude)

const SIM = 5000
const DTS = [8, 16, 33, 66]

function makeCoreChain(n: number, options?: object): { system: SpringSystem; springs: Spring[] } {
  const system = createSpringSystem(options)
  const springs: Spring[] = [system.createSpring(0, config) as Spring]
  for (let i = 1; i < n; i++) {
    const follower = system.createSpring(0, config) as Spring
    follower.target = springs[i - 1]!
    springs.push(follower)
  }
  return { system, springs }
}

for (const n of [8, 64]) {
  for (const [dname, mk] of [
    ['sinusoid A=200 f=0.75Hz', () => sinDrive(200, 0.75)],
    ['teleports seed 42', () => teleportDrive(42, 200, 300, 1200, SIM)],
  ] as const) {
    console.log(`\n${n}-link chain through the core, drive: ${dname}`)
    for (const dtMs of DTS) {
      const drive = mk()
      const truth = rk4Chain(p, n, drive, dtMs, SIM, 1e-5)
      for (const [name, options] of [
        ['HYBRID (default tol)', undefined],
        ['FOH K=1 (tol 1e9)  ', { couplingTolerance: 1e9 }],
      ] as const) {
        const { system, springs } = makeCoreChain(n, options)
        let linf = 0
        for (let f = 0; f < truth.frames; f++) {
          springs[0]!.target = drive(f * dtMs)
          system.advance(dtMs)
          const tv = truth.values[f + 1]!
          for (let i = 0; i < n; i++) {
            linf = Math.max(linf, Math.abs(springs[i]!.value - tv[i]!))
          }
        }
        console.log(`  dt=${String(dtMs).padStart(2)}ms  ${name}  Linf=${fmt(linf)}`)
      }
    }
  }
}

{
  // Demo-scale wall clock: the 512-chain under the sinusoid at 120fps
  // frames. The tick-graph closeout recorded ~0.09 ms/frame.
  const { system, springs } = makeCoreChain(512)
  const drive = sinDrive(200, 0.75)
  const frames = Math.floor(SIM / 8)
  const t0 = performance.now()
  for (let f = 0; f < frames; f++) {
    springs[0]!.target = drive(f * 8)
    system.advance(8)
  }
  const wall = performance.now() - t0
  console.log(
    `\n512-chain wall clock: ${(wall / frames).toFixed(3)} ms/frame over ${frames} frames`,
  )
}

console.log('\nnon-smooth map: follower chases clamp(leader, 100), sinusoid crossing the kink')
for (const dtMs of [16, 33, 66]) {
  const run = (sub: number): number[] => {
    const system = createSpringSystem()
    const leader = system.createSpring(0, config)
    const follower = system.createSpring(0, config)
    follower.target = mapSpring(leader, (value) => Math.min(value, 100))
    const drive = sinDrive(200, 0.75)
    const trail: number[] = []
    for (let f = 0; f * dtMs < SIM; f++) {
      leader.target = drive(f * dtMs)
      for (let i = 0; i < sub; i++) system.advance(dtMs / sub)
      trail.push(follower.value)
    }
    return trail
  }
  const reference = run(16)
  const coarse = run(1)
  let linf = 0
  for (let i = 0; i < coarse.length; i++) {
    linf = Math.max(linf, Math.abs(coarse[i]! - reference[i]!))
  }
  console.log(`  dt=${String(dtMs).padStart(2)}ms  Linf vs fine-stepped = ${fmt(linf)}`)
}
