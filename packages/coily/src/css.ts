import type { SpringDefinition } from './config.ts'
import { State } from './state.ts'
import { CriticallyDampedSolver, OverdampedSolver, UnderdampedSolver } from './solver.ts'

// PROTOTYPE — not exported from index yet. Turns a resolved spring config
// into a CSS `linear()` easing plus the duration it must be paired with.
//
// The trick: a spring released from rest has a displacement-independent
// normalized curve, so the easing SHAPE is a pure function of the config.
// The settle TIME is not — the absolute rest threshold occupies a
// different fraction of a small vs large move — so duration is derived at
// a caller-supplied `displacement`.

export interface LinearEasingOptions {
  /**
   * Animation range the duration is tuned for, in value units. The easing
   * shape is identical regardless; only the settle time scales with it.
   * @default 1
   */
  readonly displacement?: number
  /**
   * Max output error of the piecewise-linear approximation, in progress
   * units (0..1). Smaller keeps more stops. @default 0.001
   */
  readonly maxError?: number
  /** Hard cap on generated duration, in ms, for near-undamped configs. @default 10000 */
  readonly maxDuration?: number
}

export interface LinearEasing {
  /** A CSS `linear()` easing string. */
  readonly easing: string
  /** Duration to pair the easing with, in ms. */
  readonly duration: number
  /** Number of stops in the easing (diagnostic). */
  readonly stops: number
  /** Worst reconstruction error vs the dense trajectory (diagnostic). */
  readonly maxError: number
}

interface Point {
  x: number // input fraction, 0..1
  y: number // progress (output), 0 -> 1, may exceed 1 on overshoot
}

function pickSolver(config: SpringDefinition, state: State) {
  const solver =
    config.dampingRatio < 1
      ? new UnderdampedSolver(state)
      : config.dampingRatio === 1
        ? new CriticallyDampedSolver(state)
        : new OverdampedSolver(state)
  solver.configure(config)
  return solver
}

// Walk the real solver from unit-scaled rest to rest, sampling progress.
// Returns dense samples in (input-seconds, progress) and the settle time.
function sample(config: SpringDefinition, displacement: number, maxDuration: number) {
  const state = new State(config, displacement, 0)
  const solver = pickSolver(config, state)

  // Resolve oscillation and early curvature: a fraction of the natural
  // period, capped so slow springs stay cheap and stiff ones stay smooth.
  const period = (2 * Math.PI) / config.naturalFrequency
  const dt = Math.min(0.004, Math.max(0.0005, period / 48))
  const maxT = maxDuration / 1000

  const samples: Array<{ t: number; progress: number }> = [{ t: 0, progress: 0 }]
  let t = 0
  while (t < maxT) {
    solver.tick(dt)
    t += dt
    samples.push({ t, progress: 1 - state.position / displacement })
    if (state.isResting) break
  }

  // Rest is a fixpoint: snap the tail exactly to 1 so the easing lands on
  // the target the way the runtime does.
  samples[samples.length - 1]!.progress = 1
  return { samples, duration: t * 1000 }
}

// Vertical-distance Douglas-Peucker. `linear()` interpolates linearly in
// input, so vertical (output) error is exactly the approximation error.
function simplify(points: ReadonlyArray<Point>, epsilon: number): Point[] {
  const keep = Array.from({ length: points.length }, () => false)
  keep[0] = true
  keep[points.length - 1] = true

  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!
    const a = points[lo]!
    const b = points[hi]!
    const dx = b.x - a.x

    let worst = -1
    let worstIndex = -1
    for (let i = lo + 1; i < hi; i += 1) {
      const p = points[i]!
      const f = dx === 0 ? 0 : (p.x - a.x) / dx
      const interpolated = a.y + f * (b.y - a.y)
      const distance = Math.abs(p.y - interpolated)
      if (distance > worst) {
        worst = distance
        worstIndex = i
      }
    }

    if (worst > epsilon && worstIndex !== -1) {
      keep[worstIndex] = true
      stack.push([lo, worstIndex], [worstIndex, hi])
    }
  }

  return points.filter((_, i) => keep[i])
}

function trim(value: number, places: number): string {
  return Number(value.toFixed(places)).toString()
}

function format(points: ReadonlyArray<Point>): string {
  const stops = points.map((point, i) => {
    const output = trim(point.y, 5)
    // First stop is 0%, last is 100% — the browser infers both.
    if (i === 0 || i === points.length - 1) return output
    return `${output} ${trim(point.x * 100, 2)}%`
  })
  return `linear(${stops.join(', ')})`
}

// Worst output error of the simplified polyline against the dense samples.
function reconstructionError(
  dense: ReadonlyArray<Point>,
  simplified: ReadonlyArray<Point>,
): number {
  let worst = 0
  let j = 0
  for (const point of dense) {
    while (j < simplified.length - 2 && simplified[j + 1]!.x < point.x) j += 1
    const a = simplified[j]!
    const b = simplified[j + 1]!
    const dx = b.x - a.x
    const f = dx === 0 ? 0 : (point.x - a.x) / dx
    worst = Math.max(worst, Math.abs(point.y - (a.y + f * (b.y - a.y))))
  }
  return worst
}

/**
 * Turns a resolved spring config into a CSS `linear()` easing and the
 * duration to pair it with. PROTOTYPE.
 */
export function springToLinear(
  config: SpringDefinition,
  options: LinearEasingOptions = {},
): LinearEasing {
  const displacement = options.displacement ?? 1
  const maxError = options.maxError ?? 0.001
  const maxDuration = options.maxDuration ?? 10000

  const { samples, duration } = sample(config, displacement, maxDuration)

  // Normalize input to fraction of duration for the easing curve.
  const points: Point[] = samples.map((s) => ({
    x: duration === 0 ? 0 : (s.t * 1000) / duration,
    y: s.progress,
  }))

  const simplified = simplify(points, maxError)

  return {
    easing: format(simplified),
    duration,
    stops: simplified.length,
    maxError: reconstructionError(points, simplified),
  }
}
