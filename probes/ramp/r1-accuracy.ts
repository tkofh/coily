// Constant-rate proposal, claim R1: a spring following a ramp source
// tracks a continuously moving target to RK4 precision, where today's
// per-frame staircase (assign `target = from + rate * t` each frame)
// carries an error of order rate * dt.
//
// Truth: RK4 at h = 1e-5 s on the core's continuous model (C1 in
// docs/follower-coupling/math-report.md, damper to ground):
//   y'' = -2*zeta*wn*y' - wn^2 * (y - T(t))
// with T(t) evaluated continuously. Units are degrees; the rates are the
// ghost-studio ones (270 deg/s spin, 400 deg/s slew).
import { mapSpring } from '../../packages/coily/src/spring-source.ts'
import { MotionSet, Spring, SpringDefinition, createRamp } from './proto.ts'

// Integrates the continuous model to each frame boundary exactly: every
// frame is split into ceil(dt / h) equal RK4 steps, so truth and the
// library are compared at the same instants.
function rk4(config: SpringDefinition, T: (t: number) => number, frames: number[], h = 1e-5) {
  const wn = config.naturalFrequency
  const twoSigma = 2 * config.dampingRatio * wn
  const wn2 = wn * wn
  const f = (t: number, yy: number, ww: number) => -twoSigma * ww - wn2 * (yy - T(t))
  let y = 0
  let w = 0
  let t = 0
  const out: number[] = []
  for (const dtMs of frames) {
    const dt = dtMs / 1000
    const n = Math.ceil(dt / h)
    const s = dt / n
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

type Mode = 'ramp source' | 'staircase, hold start' | 'staircase, hold end'

function run(
  config: SpringDefinition,
  T: (t: number) => number,
  wire: (motions: MotionSet, follower: Spring) => void,
  mode: Mode,
  frames: number[],
) {
  const motions = new MotionSet()
  const follower = new Spring(motions, 0, config)
  const ks: number[] = []
  if (mode === 'ramp source') {
    wire(motions, follower)
    motions.graph.ensureOrder()
    for (const edge of motions.graph.edges) {
      const plan = edge.plan.bind(edge)
      edge.plan = (dt) => {
        const k = plan(dt)
        ks.push(k)
        return k
      }
    }
  }
  const samples: number[] = []
  let t = 0
  for (const dtMs of frames) {
    const dt = dtMs / 1000
    if (mode === 'staircase, hold start') follower.target = T(t)
    if (mode === 'staircase, hold end') follower.target = T(t + dt)
    motions.tick(dt)
    t += dt
    samples.push(follower.value)
  }
  // Frames past the first two whose demand exceeded 1 (the ramp's own
  // start always kinks the estimator's history).
  const lateK = ks.slice(2).filter((k) => k > 1).length
  return { samples, maxK: ks.length ? Math.max(...ks) : 1, lateK, idle: motions.size === 0 }
}

function frameTimes(dtMs: number, simS: number, jitter = false): number[] {
  let seed = 7
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const out: number[] = []
  let total = 0
  while (total < simS * 1000) {
    const dt = jitter ? dtMs * (0.5 + rand()) : dtMs
    out.push(dt)
    total += dt
  }
  return out
}

const configs: [string, SpringDefinition][] = [
  ['critical, 300ms', new SpringDefinition({ dampingRatio: 1, duration: 300, precision: 8 })],
  ['bounce 0.3, 400ms', new SpringDefinition({ bounce: 0.3, duration: 400, precision: 8 })],
]

const SIM = 2
const scenarios = [
  {
    name: 'endless spin, 270 deg/s',
    T: (t: number) => 270 * t,
    wire: (m: MotionSet, s: Spring) => {
      s.target = createRamp(m, 0, { rate: 270, target: Infinity })
    },
  },
  {
    name: 'bounded slew 0 -> 180 deg at 400 deg/s (kink at 450ms)',
    T: (t: number) => Math.min(400 * t, 180),
    wire: (m: MotionSet, s: Spring) => {
      s.target = createRamp(m, 0, { rate: 400, target: 180 })
    },
  },
  {
    name: 'pulse: 20 * sin(pi * ms / 600) over a 0 -> 600ms ramp',
    T: (t: number) => (t < 0.6 ? 20 * Math.sin((Math.PI * t) / 0.6) : 0),
    wire: (m: MotionSet, s: Spring) => {
      const clock = createRamp(m, 0, { rate: 1000, target: 600 })
      s.target = mapSpring(clock, (ms) => 20 * Math.sin((Math.PI * ms) / 600))
    },
  },
]

for (const scenario of scenarios) {
  console.log(`\n## ${scenario.name}`)
  for (const [cname, config] of configs) {
    console.log(
      `  ${cname}  (steady-state lag 2*zeta/wn*rate = ${((2 * config.dampingRatio) / config.naturalFrequency).toFixed(4)} s * rate)`,
    )
    for (const [fname, frames] of [
      ['120fps', frameTimes(1000 / 120, SIM)],
      ['60fps', frameTimes(1000 / 60, SIM)],
      ['30fps', frameTimes(1000 / 30, SIM)],
      ['60fps jitter x0.5-1.5', frameTimes(1000 / 60, SIM, true)],
    ] as const) {
      const cells: string[] = []
      for (const mode of [
        'ramp source',
        'staircase, hold start',
        'staircase, hold end',
      ] as Mode[]) {
        const truth = rk4(config, scenario.T, frames)
        const { samples, maxK, lateK, idle } = run(config, scenario.T, scenario.wire, mode, frames)
        let linf = 0
        for (let i = 0; i < samples.length; i++)
          linf = Math.max(linf, Math.abs(samples[i]! - truth[i]!))
        cells.push(
          `${mode}: ${linf.toExponential(2)}${mode === 'ramp source' ? ` (max K ${maxK}, K>1 after frame 2: ${lateK}${idle ? ', idle at end' : ''})` : ''}`,
        )
      }
      console.log(`    ${fname.padEnd(22)} ${cells.join(' | ')}`)
    }
  }
}
