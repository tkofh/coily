// Instrumented kink run: count rest events, detect update-order
// inversions (a follower ticking before its leader), and locate max kink.
import { createSpringSystem, defineSpring } from '../../packages/coily/src/index.ts'

const A_DRIVE = 300
const F_DRIVE = 1
const N_LINKS = 96
const T_TOTAL = 12
const T_SKIP = 3

function simulate(dtMs) {
  const system = createSpringSystem({ reducedMotion: 'never' })
  const config = defineSpring({ bounce: -1, duration: 265 })
  const springs = [system.createSpring(0, config)]
  for (let i = 0; i < N_LINKS; i++) springs.push(system.createSpring(springs[i], config))

  let stops = 0
  let order = []
  springs.forEach((s, i) => {
    s.onStop(() => stops++)
    s.onUpdate(() => order.push(i))
  })

  const dt = dtMs / 1000
  let t = 0
  let maxKink = 0
  let maxAt = null
  let inversionFrames = 0
  const frames = Math.round(T_TOTAL / dt)
  for (let n = 0; n < frames; n++) {
    t += dt
    order = []
    springs[0].target = A_DRIVE * Math.sin(2 * Math.PI * F_DRIVE * t)
    system.advance(dtMs)
    // order inversion: some spring i updated before a spring j < i that
    // also updated this frame (j is upstream of i, so i saw a stale value)
    const seen = new Set()
    let inverted = false
    for (const i of order) {
      for (const j of seen) if (j > i) inverted = true
      seen.add(i)
    }
    if (inverted) inversionFrames++
    if (t > T_SKIP) {
      for (let k = 1; k < springs.length - 1; k++) {
        const kink = Math.abs(springs[k + 1].value - 2 * springs[k].value + springs[k - 1].value)
        if (kink > maxKink) {
          maxKink = kink
          maxAt = { k, t: t.toFixed(2) }
        }
      }
    }
  }
  return { maxKink, maxAt, stops, inversionFrames, frames }
}

console.log(' dt(ms) |   kink  | at link | at t  | stop events | frames w/ inversion / total')
for (const dtMs of [16, 33, 40, 47, 66, 133, 200, 265]) {
  const r = simulate(dtMs)
  console.log(
    ` ${String(dtMs).padStart(5)} | ${r.maxKink.toFixed(2).padStart(7)} | ${String(r.maxAt?.k).padStart(6)} | ${r.maxAt?.t.padStart(5)} | ${String(r.stops).padStart(11)} | ${r.inversionFrames} / ${r.frames}`,
  )
}
