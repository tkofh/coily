// Constant-rate proposal, claim R2: a bounded ramp's arrival is a kink
// inside a frame. Today's controller plans sub-steps from history, which
// cannot see it coming, so the arrival frame runs at K = 1 and the
// follower's FOH spreads the slope change over the whole frame. Sweeps
// the arrival's phase within the frame, and measures one remedy: the
// ramp, which knows its arrival time exactly, demands the sub-step cap
// on the frame it arrives in.
import { MotionSet, Spring, SpringDefinition, createRamp } from './proto.ts'

const config = new SpringDefinition({ dampingRatio: 1, duration: 300, precision: 8 })
const rate = 400

function truthAt(target: number, frames: number) {
  // Continuous reference, as in r1, integrated to frame boundaries.
  const wn = config.naturalFrequency
  const twoSigma = 2 * config.dampingRatio * wn
  const T = (t: number) => Math.min(rate * t, target)
  return (dtMs: number) => {
    const out: number[] = []
    let y = 0,
      w = 0,
      t = 0
    const f = (tt: number, yy: number, ww: number) => -twoSigma * ww - wn * wn * (yy - T(tt))
    for (let k = 0; k < frames; k++) {
      const n = Math.ceil(dtMs / 1000 / 1e-5)
      const s = dtMs / 1000 / n
      for (let i = 0; i < n; i++) {
        const k1y = w,
          k1w = f(t, y, w)
        const k2y = w + (s / 2) * k1w,
          k2w = f(t + s / 2, y + (s / 2) * k1y, w + (s / 2) * k1w)
        const k3y = w + (s / 2) * k2w,
          k3w = f(t + s / 2, y + (s / 2) * k2y, w + (s / 2) * k2w)
        const k4y = w + s * k3w,
          k4w = f(t + s, y + s * k3y, w + s * k3w)
        y += (s / 6) * (k1y + 2 * k2y + 2 * k3y + k4y)
        w += (s / 6) * (k1w + 2 * k2w + 2 * k3w + k4w)
        t += s
      }
      out.push(y)
    }
    return out
  }
}

function run(target: number, dtMs: number, frames: number, arrivalDemand: boolean) {
  const motions = new MotionSet()
  const follower = new Spring(motions, 0, config)
  const ramp = createRamp(motions, 0, { rate, target })
  follower.target = ramp
  motions.graph.ensureOrder()
  if (arrivalDemand) {
    for (const edge of motions.graph.edges) {
      const plan = edge.plan.bind(edge)
      edge.plan = (dt) => {
        const k = plan(dt)
        const m = ramp.motion
        const arrives = !m.isResting && Math.abs(m.rampTarget - m.value) < m.rate * dt
        return arrives ? Math.max(k, 8) : k
      }
    }
  }
  const out: number[] = []
  for (let k = 0; k < frames; k++) {
    motions.tick(dtMs / 1000)
    out.push(follower.value)
  }
  return out
}

for (const fps of [60, 30]) {
  const dtMs = 1000 / fps
  const frames = Math.round(1500 / dtMs)
  let worstPlain = 0
  let worstDemand = 0
  console.log(
    `\n${fps}fps: arrival phase within frame -> Linf (deg), plain | arrival frame at K = 8`,
  )
  for (const phase of [0, 0.1, 0.25, 0.5, 0.75, 0.9]) {
    // Arrival lands `phase` of the way through frame 20.
    const arrivalS = ((20 + phase) * dtMs) / 1000
    const target = rate * arrivalS
    const truth = truthAt(target, frames)(dtMs)
    const linf = (xs: number[]) => Math.max(...xs.map((v, i) => Math.abs(v - truth[i]!)))
    const plain = linf(run(target, dtMs, frames, false))
    const demand = linf(run(target, dtMs, frames, true))
    worstPlain = Math.max(worstPlain, plain)
    worstDemand = Math.max(worstDemand, demand)
    console.log(
      `  phase ${phase.toFixed(2)}  ${plain.toExponential(2)} | ${demand.toExponential(2)}`,
    )
  }
  console.log(
    `  worst: ${worstPlain.toExponential(2)} | ${worstDemand.toExponential(2)}  (rate * dt = ${((rate * dtMs) / 1000).toFixed(2)} deg)`,
  )
}
