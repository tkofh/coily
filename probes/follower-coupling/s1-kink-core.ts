// Kink sweep on the REAL core, 512 links: default precision (rest/wake
// reordering active) vs precision 12 (no rest; ordering stays leader-first).
import {
  createSpringSystem,
  defineSpring,
  type SpringDefinition,
  type Spring,
} from '../../packages/coily/src/index.ts'
import { sinDrive, teleportDrive, kinkOf, fmt } from './problib.ts'

const N = 512
const SIM = 15000
const WARM = 1000

function coreKink(config: SpringDefinition, drive: (tMs: number) => number, dtMs: number): number {
  const system = createSpringSystem({ reducedMotion: 'never' })
  const springs: Spring[] = []
  springs.push(system.createSpring(0, config))
  for (let i = 1; i < N; i++) springs.push(system.createSpring(springs[i - 1]!, config))
  const frames = Math.floor(SIM / dtMs)
  const vals = new Float64Array(N)
  let kink = 0
  for (let f = 0; f < frames; f++) {
    const t = f * dtMs
    springs[0]!.target = drive(t)
    system.advance(dtMs)
    if (t + dtMs >= WARM) {
      for (let i = 0; i < N; i++) vals[i] = springs[i]!.value
      const k = kinkOf(vals)
      if (k > kink) kink = k
    }
  }
  return kink
}

const dts = [8, 16, 33, 66]
const p2 = defineSpring({ bounce: -1, duration: 265 })
const p12 = defineSpring({ bounce: -1, duration: 265, precision: 12 })

for (const [name, drive] of [
  ['sinusoid A=200 f=0.75Hz', sinDrive(200, 0.75)],
  ['teleports seed 42', teleportDrive(42, 200, 300, 1200, SIM)],
] as const) {
  console.log(`drive: ${name}`)
  for (const dt of dts) {
    const t0 = performance.now()
    const k2 = coreKink(p2, drive, dt)
    const k12 = coreKink(p12, drive, dt)
    console.log(
      `  dt=${String(dt).padStart(2)}ms  kink(core, precision 2)=${fmt(k2, 2).padStart(9)}   kink(core, precision 12)=${fmt(k12, 2).padStart(9)}   (${(performance.now() - t0).toFixed(0)}ms wall)`,
    )
  }
  console.log()
}
