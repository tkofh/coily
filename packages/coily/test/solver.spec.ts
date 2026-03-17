import { describe, expect, test } from 'vitest'
import { createSpringSystem, defineSpring } from '../src/index.ts'

/**
 * Helper: simulate a spring for a given duration at a fixed time step.
 * Returns an array of { time, value, velocity } snapshots.
 */
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
  const spring = system.createSpring({ target: params.target, value: params.value }, config)

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

/**
 * Computes the damping ratio for given spring parameters.
 */
function dampingRatio(mass: number, tension: number, damping: number) {
  const wn = Math.sqrt(tension / mass)
  const cc = 2 * mass * wn
  return damping / cc
}

describe('physics: underdamped (ζ < 1)', () => {
  // ζ = 10 / (2 * 1 * √170) ≈ 0.383
  const params = { mass: 1, tension: 170, damping: 10, target: 0, value: 100 }

  test('damping ratio is less than 1', () => {
    expect(dampingRatio(params.mass, params.tension, params.damping)).toBeLessThan(1)
  })

  test('overshoots the target (oscillates past zero)', () => {
    const { snapshots } = simulate(params, 3000)
    const values = snapshots.map((s) => s.value)

    // Should cross zero (target) at some point, meaning some values are negative
    const hasNegative = values.some((v) => v < -0.5)
    expect(hasNegative).toBe(true)
  })

  test('eventually comes to rest at target', () => {
    const { spring } = simulate(params, 10000)
    expect(spring.resting).toBe(true)
    expect(spring.value).toBeCloseTo(0, 1)
  })

  test('oscillation amplitude decays over time', () => {
    // Use lower damping to get more visible oscillations
    const bouncy = { mass: 1, tension: 170, damping: 5, target: 0, value: 100 }
    const { snapshots } = simulate(bouncy, 5000)

    // Find successive local maxima (positive peaks) and verify each is smaller than the last
    const maxima: number[] = []
    for (let i = 1; i < snapshots.length - 1; i++) {
      const prev = snapshots[i - 1]!.value
      const curr = snapshots[i]!.value
      const next = snapshots[i + 1]!.value
      if (curr > prev && curr > next && curr > 0.5) {
        maxima.push(curr)
      }
    }

    // Should have at least 2 positive peaks to verify decay
    expect(maxima.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < maxima.length; i++) {
      expect(maxima[i]).toBeLessThan(maxima[i - 1]!)
    }
  })
})

describe('physics: critically damped (ζ = 1)', () => {
  // ζ = 2*√170 / (2 * 1 * √170) = 1.0
  const wn = Math.sqrt(170)
  const cc = 2 * 1 * wn
  const params = { mass: 1, tension: 170, damping: cc, target: 0, value: 100 }

  test('damping ratio is exactly 1', () => {
    expect(dampingRatio(params.mass, params.tension, params.damping)).toBeCloseTo(1, 10)
  })

  test('does not overshoot target', () => {
    const { snapshots } = simulate(params, 5000)

    // Starting at value=100 targeting 0: all values should remain >= 0
    // (no overshoot past target)
    for (const snap of snapshots) {
      expect(snap.value).toBeGreaterThanOrEqual(-0.02) // tiny numerical tolerance
    }
  })

  test('eventually comes to rest at target', () => {
    const { spring } = simulate(params, 10000)
    expect(spring.resting).toBe(true)
    expect(spring.value).toBeCloseTo(0, 1)
  })

  test('approaches target monotonically', () => {
    const { snapshots } = simulate(params, 5000)

    // Distance from target should generally decrease (allowing small floating point noise)
    let maxDistance = Math.abs(snapshots[0]!.value)
    let violations = 0
    for (let i = 1; i < snapshots.length; i++) {
      const distance = Math.abs(snapshots[i]!.value)
      if (distance > maxDistance + 0.01) {
        violations++
      }
      maxDistance = Math.min(maxDistance, distance)
    }

    // Allow at most a tiny handful of violations from numerical noise
    expect(violations).toBeLessThanOrEqual(2)
  })
})

describe('physics: overdamped (ζ > 1)', () => {
  // ζ = 40 / (2 * 1 * √170) ≈ 1.53
  const params = { mass: 1, tension: 170, damping: 40, target: 0, value: 100 }

  test('damping ratio is greater than 1', () => {
    expect(dampingRatio(params.mass, params.tension, params.damping)).toBeGreaterThan(1)
  })

  test('does not overshoot target', () => {
    const { snapshots } = simulate(params, 10000)

    // Starting at 100, targeting 0: values should stay >= 0
    for (const snap of snapshots) {
      expect(snap.value).toBeGreaterThanOrEqual(-0.02)
    }
  })

  test('eventually comes to rest at target', () => {
    const { spring } = simulate(params, 15000)
    expect(spring.resting).toBe(true)
    expect(spring.value).toBeCloseTo(0, 1)
  })

  test('approaches target more slowly than critically damped', () => {
    const wn = Math.sqrt(170)
    const cc = 2 * 1 * wn
    const criticalParams = { mass: 1, tension: 170, damping: cc, target: 0, value: 100 }

    const { snapshots: overdamped } = simulate(params, 5000)
    const { snapshots: critical } = simulate(criticalParams, 5000)

    // At the same time point, the overdamped spring should be further from target
    // Check at t ≈ 0.5s (roughly frame 30)
    const idx = 30
    if (overdamped[idx] && critical[idx]) {
      expect(Math.abs(overdamped[idx].value)).toBeGreaterThan(Math.abs(critical[idx].value))
    }
  })
})

describe('physics: general properties', () => {
  test('zero damping oscillates indefinitely (never rests)', () => {
    // ζ = 0 → pure harmonic oscillator
    const { spring, snapshots } = simulate(
      { mass: 1, tension: 100, damping: 0, target: 0, value: 50 },
      5000,
    )

    // Should still be moving after 5 seconds
    expect(spring.resting).toBe(false)

    // Amplitude should remain roughly constant (conservation of energy in undamped case)
    const maxima: number[] = []
    for (let i = 1; i < snapshots.length - 1; i++) {
      const prev = snapshots[i - 1]!.value
      const curr = snapshots[i]!.value
      const next = snapshots[i + 1]!.value
      if (curr > prev && curr > next) {
        maxima.push(Math.abs(curr))
      }
    }

    if (maxima.length >= 2) {
      const first = maxima[0]!
      const last = maxima[maxima.length - 1]!
      // Should be within ~5% (some rounding error from State class)
      expect(last / first).toBeGreaterThan(0.9)
    }
  })

  test('heavier mass results in slower oscillation', () => {
    const light = simulate({ mass: 1, tension: 100, damping: 2, target: 0, value: 50 }, 3000)
    const heavy = simulate({ mass: 10, tension: 100, damping: 2, target: 0, value: 50 }, 3000)

    // Count zero crossings — lighter mass should cross more
    function zeroCrossings(snaps: { value: number }[]) {
      let crossings = 0
      for (let i = 1; i < snaps.length; i++) {
        if (Math.sign(snaps[i]!.value) !== Math.sign(snaps[i - 1]!.value)) {
          crossings++
        }
      }
      return crossings
    }

    expect(zeroCrossings(light.snapshots)).toBeGreaterThan(zeroCrossings(heavy.snapshots))
  })

  test('higher tension results in faster oscillation', () => {
    const low = simulate({ mass: 1, tension: 50, damping: 2, target: 0, value: 50 }, 3000)
    const high = simulate({ mass: 1, tension: 200, damping: 2, target: 0, value: 50 }, 3000)

    function zeroCrossings(snaps: { value: number }[]) {
      let crossings = 0
      for (let i = 1; i < snaps.length; i++) {
        if (Math.sign(snaps[i]!.value) !== Math.sign(snaps[i - 1]!.value)) {
          crossings++
        }
      }
      return crossings
    }

    expect(zeroCrossings(high.snapshots)).toBeGreaterThan(zeroCrossings(low.snapshots))
  })

  test('symmetric initial conditions produce mirrored trajectories', () => {
    const positive = simulate({ mass: 1, tension: 170, damping: 10, target: 0, value: 50 }, 2000)
    const negative = simulate({ mass: 1, tension: 170, damping: 10, target: 0, value: -50 }, 2000)

    // Values should be exact negations of each other
    for (let i = 0; i < positive.snapshots.length; i++) {
      expect(positive.snapshots[i]!.value).toBeCloseTo(-negative.snapshots[i]!.value, 5)
    }
  })

  test('different targets work correctly', () => {
    // Spring targeting 200 from value 100
    const { spring } = simulate(
      { mass: 1, tension: 170, damping: 26, target: 200, value: 100 },
      10000,
    )
    expect(spring.resting).toBe(true)
    expect(spring.value).toBeCloseTo(200, 0)
  })

  test('negative targets work correctly', () => {
    const { spring } = simulate(
      { mass: 1, tension: 170, damping: 26, target: -100, value: 0 },
      10000,
    )
    expect(spring.resting).toBe(true)
    expect(spring.value).toBeCloseTo(-100, 0)
  })
})
