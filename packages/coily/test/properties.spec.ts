import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { createSpringSystem } from '../src/index'
import { settlingTime } from '../src/util'

/**
 * Number of iterations for convergence tests.
 * We compute the analytical settling time and divide by this
 * to get the per-tick dt — no blind iteration needed.
 */
const ITERATIONS = 300

/**
 * Arbitrary for valid spring parameters.
 * Damping is derived as a fraction of critical damping so the
 * damping ratio is always physically meaningful.
 */
const springParamsArb = fc
  .record({
    mass: fc.double({ min: 0.5, max: 50, noNaN: true }),
    tension: fc.double({ min: 10, max: 500, noNaN: true }),
    // Damping ratio between 0.1 and 3 (covers underdamped, critical, overdamped)
    dampingRatio: fc.double({ min: 0.1, max: 3, noNaN: true }),
    // Displacement magnitude well above the resting threshold (0.01 at precision 2).
    // Sub-threshold displacements are trivial and dominated by rounding artifacts,
    // not spring physics — not useful to test analytically.
    displacement: fc.double({ min: 1, max: 500, noNaN: true }),
    target: fc.double({ min: -200, max: 200, noNaN: true }),
    sign: fc.constantFrom(1, -1),
  })
  .map(({ mass, tension, dampingRatio, displacement, target, sign }) => {
    const cc = 2 * Math.sqrt(mass * tension)
    return { mass, tension, damping: dampingRatio * cc, value: target + sign * displacement, target }
  })

/**
 * Simulate a spring to completion using the analytical settling time estimate.
 * Returns the dt used per tick and the final spring state.
 */
function simulateToSettling(
  params: { mass: number; tension: number; damping: number; value: number; target: number },
  iterations = ITERATIONS,
) {
  const displacement = params.value - params.target
  const est = settlingTime({ ...params, displacement })

  const system = createSpringSystem()
  const spring = system.createSpring(params)

  const dt = (est * 1000) / iterations

  for (let i = 0; i < iterations; i++) {
    system.advance(dt)
  }

  return { spring, system, dt, estimatedTime: est }
}

describe('property-based: convergence', () => {
  test('any spring with damping > 0 eventually comes to rest', () => {
    fc.assert(
      fc.property(springParamsArb, (params) => {
        const { spring } = simulateToSettling(params)
        return spring.resting
      }),
      { numRuns: 200 },
    )
  })

  test('resting value is at the target', () => {
    fc.assert(
      fc.property(springParamsArb, (params) => {
        const { spring } = simulateToSettling(params)

        const tolerance = Math.max(Math.abs(params.target) * 0.01, 1)
        expect(Math.abs(spring.value - params.target)).toBeLessThan(tolerance)
      }),
      { numRuns: 200 },
    )
  })
})

describe('property-based: no NaN or Infinity', () => {
  test('position and velocity remain finite during simulation', () => {
    fc.assert(
      fc.property(springParamsArb, (params) => {
        const displacement = params.value - params.target
        const est = settlingTime({ ...params, displacement })
        const dt = (est * 1000) / ITERATIONS

        const system = createSpringSystem()
        const spring = system.createSpring(params)

        for (let i = 0; i < ITERATIONS; i++) {
          system.advance(dt)
          expect(Number.isFinite(spring.value)).toBe(true)
          expect(Number.isFinite(spring.velocity)).toBe(true)
        }
      }),
      { numRuns: 200 },
    )
  })
})

describe('property-based: symmetry', () => {
  test('negating initial displacement negates the trajectory', () => {
    const paramsArb = fc
      .record({
        mass: fc.double({ min: 0.5, max: 50, noNaN: true }),
        tension: fc.double({ min: 10, max: 500, noNaN: true }),
        dampingRatio: fc.double({ min: 0.1, max: 3, noNaN: true }),
        displacement: fc.double({ min: 1, max: 500, noNaN: true }),
      })
      .map(({ mass, tension, dampingRatio, displacement }) => {
        const cc = 2 * Math.sqrt(mass * tension)
        return { mass, tension, damping: dampingRatio * cc, displacement }
      })

    fc.assert(
      fc.property(paramsArb, ({ mass, tension, damping, displacement }) => {
        const system1 = createSpringSystem()
        const system2 = createSpringSystem()

        const s1 = system1.createSpring({ mass, tension, damping, target: 0, value: displacement })
        const s2 = system2.createSpring({ mass, tension, damping, target: 0, value: -displacement })

        const est = settlingTime({ mass, tension, damping, displacement })
        const dt = (est * 1000) / ITERATIONS

        for (let i = 0; i < ITERATIONS; i++) {
          system1.advance(dt)
          system2.advance(dt)
          expect(s1.value).toBeCloseTo(-s2.value, 4)
        }
      }),
      { numRuns: 100 },
    )
  })
})

describe('property-based: monotonicity for overdamped springs', () => {
  test('overdamped springs approach target monotonically from one side', () => {
    const overdampedArb = fc
      .record({
        mass: fc.double({ min: 0.5, max: 10, noNaN: true }),
        tension: fc.double({ min: 10, max: 200, noNaN: true }),
        // ζ > 1 for overdamped
        dampingRatio: fc.double({ min: 1.5, max: 5, noNaN: true }),
        displacement: fc.double({ min: 10, max: 500, noNaN: true }),
      })
      .map(({ mass, tension, dampingRatio, displacement }) => {
        const cc = 2 * Math.sqrt(mass * tension)
        return { mass, tension, damping: dampingRatio * cc, displacement }
      })

    fc.assert(
      fc.property(overdampedArb, ({ mass, tension, damping, displacement }) => {
        const system = createSpringSystem()
        const spring = system.createSpring({ mass, tension, damping, target: 0, value: displacement })

        const est = settlingTime({ mass, tension, damping, displacement })
        const dt = (est * 1000) / ITERATIONS

        let prevDistance = Math.abs(spring.value)
        let violations = 0

        for (let i = 0; i < ITERATIONS; i++) {
          system.advance(dt)
          const distance = Math.abs(spring.value)

          if (distance > prevDistance + 0.02) violations++
          prevDistance = distance
        }

        expect(violations).toBeLessThanOrEqual(3)
      }),
      { numRuns: 100 },
    )
  })
})

describe('property-based: energy', () => {
  test('underdamped springs have decreasing total energy over time', () => {
    const underdampedArb = fc
      .record({
        mass: fc.double({ min: 0.5, max: 10, noNaN: true }),
        tension: fc.double({ min: 10, max: 500, noNaN: true }),
        // ζ < 1 for underdamped
        dampingRatio: fc.double({ min: 0.1, max: 0.9, noNaN: true }),
        displacement: fc.double({ min: 10, max: 200, noNaN: true }),
      })
      .map(({ mass, tension, dampingRatio, displacement }) => {
        const cc = 2 * Math.sqrt(mass * tension)
        return { mass, tension, damping: dampingRatio * cc, displacement }
      })

    fc.assert(
      fc.property(underdampedArb, ({ mass, tension, damping, displacement }) => {
        const system = createSpringSystem()
        const spring = system.createSpring({ mass, tension, damping, target: 0, value: displacement })

        const est = settlingTime({ mass, tension, damping, displacement })
        const dt = (est * 1000) / ITERATIONS

        function energy() {
          const pos = spring.value
          const vel = spring.velocity
          return 0.5 * mass * vel * vel + 0.5 * tension * pos * pos
        }

        // Sample energy at intervals to smooth noise
        const energies: number[] = []
        for (let i = 0; i < ITERATIONS; i++) {
          if (i % 10 === 0) energies.push(energy())
          system.advance(dt)
        }

        let decreases = 0
        for (let i = 1; i < energies.length; i++) {
          if (energies[i] < energies[i - 1] + 0.01) decreases++
        }

        expect(decreases / (energies.length - 1)).toBeGreaterThan(0.8)
      }),
      { numRuns: 100 },
    )
  })
})

describe('property-based: target changes', () => {
  test('spring converges to new target after mid-simulation change', () => {
    fc.assert(
      fc.property(
        springParamsArb,
        fc.double({ min: -200, max: 200, noNaN: true }),
        (params, newTarget) => {
          const system = createSpringSystem()
          const spring = system.createSpring(params)

          // Run for a fraction of estimated settling time
          const initialEst = settlingTime({
            ...params,
            displacement: params.value - params.target,
          })
          const warmupDt = (initialEst * 1000) / ITERATIONS
          for (let i = 0; i < 60; i++) system.advance(warmupDt)

          // Change target
          spring.target = newTarget

          // Compute new settling time from current state
          const newDisplacement = spring.value - newTarget
          const newEst = settlingTime({
            mass: params.mass,
            tension: params.tension,
            damping: params.damping,
            displacement: newDisplacement,
            velocity: spring.velocity,
          })
          const dt = (newEst * 1000) / ITERATIONS

          for (let i = 0; i < ITERATIONS; i++) {
            system.advance(dt)
          }

          const tolerance = Math.max(Math.abs(newTarget) * 0.01, 1)
          expect(Math.abs(spring.value - newTarget)).toBeLessThan(tolerance)
        },
      ),
      { numRuns: 100 },
    )
  })
})
