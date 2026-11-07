import { describe, expect, test } from 'vitest'
import { createSpringSystem, defineSpring } from '../src/index.ts'
import { SpringDefinition } from '../src/config.ts'
import { State } from '../src/state.ts'
import { OverdampedSolver } from '../src/solver.ts'

/**
 * The textbook behavior that tells each damping regime apart, pinned
 * through the public API with fixed parameters. The random-input laws
 * (convergence, symmetry, no NaN, overdamped monotonicity, underdamped
 * energy decay) live in `properties.spec.ts`.
 */

/** Simulates a spring at a fixed step and returns a value and velocity snapshot per frame. */
function simulate(
  params: { mass: number; tension: number; damping: number; target: number; value: number },
  duration: number,
  dt = 1000 / 60,
) {
  const system = createSpringSystem()
  const config = defineSpring({
    mass: params.mass,
    tension: params.tension,
    damping: params.damping,
  })
  const spring = system.createSpring(params.value, config)
  spring.target = params.target

  const snapshots: { time: number; value: number; velocity: number }[] = []
  let t = 0

  snapshots.push({ time: 0, value: spring.value, velocity: spring.velocity })

  while (t < duration) {
    system.advance(dt)
    t += dt
    snapshots.push({ time: t, value: spring.value, velocity: spring.velocity })
  }

  return { spring, snapshots, system }
}

function zeroCrossings(snapshots: { value: number }[]) {
  let crossings = 0
  for (let i = 1; i < snapshots.length; i++) {
    if (Math.sign(snapshots[i]!.value) !== Math.sign(snapshots[i - 1]!.value)) {
      crossings++
    }
  }
  return crossings
}

describe('physics: regime character', () => {
  test('underdamped (ζ < 1) overshoots the target', () => {
    // zeta = 10 / (2 * sqrt(170)), about 0.38
    const { snapshots } = simulate(
      { mass: 1, tension: 170, damping: 10, target: 0, value: 100 },
      3000,
    )

    expect(snapshots.some((snap) => snap.value < -0.5)).toBe(true)
  })

  test('critically damped (ζ = 1) does not overshoot the target', () => {
    const wn = Math.sqrt(170)
    const cc = 2 * wn
    const { snapshots } = simulate(
      { mass: 1, tension: 170, damping: cc, target: 0, value: 100 },
      5000,
    )

    // Never below 0, within numerical tolerance.
    for (const snap of snapshots) {
      expect(snap.value).toBeGreaterThanOrEqual(-0.02)
    }
  })

  test('overdamped (ζ > 1) approaches the target more slowly than critically damped', () => {
    const wn = Math.sqrt(170)
    const cc = 2 * wn
    const { snapshots: overdamped } = simulate(
      { mass: 1, tension: 170, damping: 40, target: 0, value: 100 },
      5000,
    )
    const { snapshots: critical } = simulate(
      { mass: 1, tension: 170, damping: cc, target: 0, value: 100 },
      5000,
    )

    // At the same time (about 500 ms), the overdamped spring is further out.
    const idx = 30
    expect(Math.abs(overdamped[idx]!.value)).toBeGreaterThan(Math.abs(critical[idx]!.value))
  })

  test('zero damping oscillates indefinitely at roughly constant amplitude', () => {
    const { spring, snapshots } = simulate(
      { mass: 1, tension: 100, damping: 0, target: 0, value: 50 },
      5000,
    )

    // An undamped spring is still moving after 5000 ms, and it keeps its
    // energy, so the peaks hold.
    expect(spring.isResting).toBe(false)

    const maxima: number[] = []
    for (let i = 1; i < snapshots.length - 1; i++) {
      const prev = snapshots[i - 1]!.value
      const curr = snapshots[i]!.value
      const next = snapshots[i + 1]!.value
      if (curr > prev && curr > next) maxima.push(Math.abs(curr))
    }

    expect(maxima.length).toBeGreaterThanOrEqual(2)
    expect(maxima.at(-1)! / maxima[0]!).toBeGreaterThan(0.9)
  })

  test('heavier mass oscillates more slowly than lighter mass', () => {
    const light = simulate({ mass: 1, tension: 100, damping: 2, target: 0, value: 50 }, 3000)
    const heavy = simulate({ mass: 10, tension: 100, damping: 2, target: 0, value: 50 }, 3000)

    expect(zeroCrossings(light.snapshots)).toBeGreaterThan(zeroCrossings(heavy.snapshots))
  })

  test('higher tension oscillates faster than lower tension', () => {
    const low = simulate({ mass: 1, tension: 50, damping: 2, target: 0, value: 50 }, 3000)
    const high = simulate({ mass: 1, tension: 200, damping: 2, target: 0, value: 50 }, 3000)

    expect(zeroCrossings(high.snapshots)).toBeGreaterThan(zeroCrossings(low.snapshots))
  })
})

// The overdamped solution as its two decaying modes, x(t) = A * exp(r1 * t)
// + B * exp(r2 * t). Both exponents are negative, so it is safe at any t.
function overdampedExact(tension: number, dampingRatio: number, x0: number, t: number) {
  const wn = Math.sqrt(tension)
  const sigma = dampingRatio * wn
  const wd = wn * Math.sqrt(dampingRatio ** 2 - 1)
  const c1 = sigma * x0
  const c2 = x0 * wd
  return (
    ((c1 + c2) * Math.exp((wd - sigma) * t) - (c1 - c2) * Math.exp(-(wd + sigma) * t)) / (2 * wd)
  )
}

describe('physics: overdamped solver overflow guard', () => {
  test('a tick past the hyperbolic overflow point lands on the exact curve', () => {
    // sinh and cosh overflow to Infinity near an argument of 710. One tick
    // to wd * t of about 980 must still land a finite, exact state.
    const config = new SpringDefinition({ tension: 100, damping: 100 }) // zeta = 5, wd about 49
    const state = new State(config, 100, 0)
    const solver = new OverdampedSolver(state)

    solver.configure(config)
    solver.tick(20)

    expect(Number.isFinite(state.position)).toBe(true)
    expect(Number.isFinite(state.velocity)).toBe(true)
    const exact = overdampedExact(100, 5, 100, 20)
    expect(Math.abs(state.position - exact) / exact).toBeLessThan(1e-12)
  })
})

describe('physics: heavy damping', () => {
  // A heavy spring's slow mode decays at about wn / (2 * dampingRatio), so
  // much of its displacement is left long after wd * t grows large.
  test.each([5, 10, 30])('dampingRatio %d follows the exact curve until it rests', (zeta) => {
    const system = createSpringSystem({ reducedMotion: 'never' })
    const spring = system.createSpring(100, defineSpring({ tension: 100, dampingRatio: zeta }))
    spring.target = 0
    const predicted = spring.timeRemaining

    let t = 0
    for (;;) {
      system.advance(16)
      t += 16
      if (spring.isResting) break
      // Within 1e-9 of the 100-unit move.
      const exact = overdampedExact(100, zeta, 100, t / 1000)
      expect(Math.abs(spring.value - exact)).toBeLessThan(1e-7)
    }
    // It rests on the first frame at or after the solved rest time.
    expect(t).toBeGreaterThanOrEqual(predicted)
    expect(t - predicted).toBeLessThan(16)
  })

  test.each([1, 300])(
    'a duration config with dampingRatio 10 rests at its duration (displacement %d)',
    (displacement) => {
      const system = createSpringSystem({ reducedMotion: 'never' })
      const spring = system.createSpring(
        displacement,
        defineSpring({ duration: 500, dampingRatio: 10, displacement }),
      )
      spring.target = 0

      let t = 0
      while (!spring.isResting) {
        system.advance(1)
        t += 1
      }
      expect(t).toBeGreaterThanOrEqual(499)
      expect(t).toBeLessThanOrEqual(501)
    },
  )
})
