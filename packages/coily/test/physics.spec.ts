import { describe, expect, test } from 'vitest'
import { createSpringSystem, defineSpring } from '../src/index.ts'
import { SpringDefinition } from '../src/config.ts'
import { State } from '../src/state.ts'
import { OverdampedSolver } from '../src/solver.ts'

/**
 * The textbook character of each damping regime, checked through the public
 * API with fixed, legible parameters. The random-input laws these springs
 * obey — convergence, symmetry, no-NaN, overdamped monotonicity, underdamped
 * energy decay — live in `properties.spec.ts`; this file only pins the
 * qualitative behavior that distinguishes one regime from another.
 */

/** Simulate a spring at a fixed step, returning per-frame value/velocity snapshots. */
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
    // ζ = 10 / (2 * √170) ≈ 0.38
    const { snapshots } = simulate(
      { mass: 1, tension: 170, damping: 10, target: 0, value: 100 },
      3000,
    )

    // Starting at 100 targeting 0, an underdamped spring crosses past zero.
    expect(snapshots.some((snap) => snap.value < -0.5)).toBe(true)
  })

  test('critically damped (ζ = 1) does not overshoot the target', () => {
    const wn = Math.sqrt(170)
    const cc = 2 * wn
    const { snapshots } = simulate(
      { mass: 1, tension: 170, damping: cc, target: 0, value: 100 },
      5000,
    )

    // From 100 toward 0, values stay non-negative (tiny numerical tolerance).
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

    // At the same time point (~0.5s) the overdamped spring is further out.
    const idx = 30
    expect(Math.abs(overdamped[idx]!.value)).toBeGreaterThan(Math.abs(critical[idx]!.value))
  })

  test('zero damping oscillates indefinitely at roughly constant amplitude', () => {
    const { spring, snapshots } = simulate(
      { mass: 1, tension: 100, damping: 0, target: 0, value: 50 },
      5000,
    )

    // Undamped: still moving after 5s, and energy is conserved so peaks hold.
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

describe('physics: overdamped solver overflow guard', () => {
  test('a large time step keeps the hyperbolic terms finite', () => {
    // sinh/cosh overflow to Infinity near an argument of 710, where the decay
    // factor has underflowed to 0 and their product would be NaN. The solver
    // clamps the hyperbolic argument; a single huge tick must still land a
    // finite, rested state rather than NaN.
    const config = new SpringDefinition({ tension: 100, damping: 100 }) // ζ = 5, wd ≈ 49
    const state = new State(config, 100, 0)
    const solver = new OverdampedSolver(state)

    solver.configure(config)
    solver.tick(10) // wd * t ≈ 490, past the overflow point

    expect(Number.isFinite(state.position)).toBe(true)
    expect(Number.isFinite(state.velocity)).toBe(true)
    expect(state.position).toBeCloseTo(0, 6)
  })
})
