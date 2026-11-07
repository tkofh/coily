import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { createSpringSystem, defineSpring } from '../src/index.ts'

/**
 * Ticks per convergence test. Each test's dt is its solved rest time
 * divided by this, so no test guesses how long to run.
 */
const ITERATIONS = 300

/** Valid spring parameters, with damping drawn as a ratio of critical damping. */
const springParamsArb = fc
  .record({
    mass: fc.double({ min: 0.5, max: 50, noNaN: true }),
    tension: fc.double({ min: 10, max: 500, noNaN: true }),
    // Spans underdamped and overdamped. A random double is almost never
    // exactly 1, so the critically damped solver gets no coverage here.
    dampingRatio: fc.double({ min: 0.1, max: 3, noNaN: true }),
    // Well above the 0.005 resting threshold. A smaller displacement rests
    // at once and tests nothing.
    displacement: fc.double({ min: 1, max: 500, noNaN: true }),
    target: fc.double({ min: -200, max: 200, noNaN: true }),
    sign: fc.constantFrom(1, -1),
  })
  .map(({ mass, tension, dampingRatio, displacement, target, sign }) => {
    const cc = 2 * Math.sqrt(mass * tension)
    return {
      mass,
      tension,
      damping: dampingRatio * cc,
      value: target + sign * displacement,
      target,
    }
  })

/**
 * Simulates a spring to completion over its solved rest time. Returns the
 * dt used per tick and the final spring state.
 */
function simulateToSettling(
  params: { mass: number; tension: number; damping: number; value: number; target: number },
  iterations = ITERATIONS,
) {
  const config = defineSpring({
    mass: params.mass,
    tension: params.tension,
    damping: params.damping,
  })
  const displacement = params.value - params.target
  const est = config.computeTimeRemaining({ position: displacement, velocity: 0 })

  const system = createSpringSystem()
  const spring = system.createSpring(params.value, config)
  spring.target = params.target

  const dt = est / iterations

  // Two extra ticks: summed dt steps can land an ulp short of the exact
  // bound, and rest waits for the first tick at or after it.
  for (let i = 0; i < iterations + 2; i++) {
    system.advance(dt)
  }

  return { spring, system, dt, estimatedTime: est }
}

describe('property-based: convergence', () => {
  test('any spring with damping > 0 eventually comes to rest', () => {
    fc.assert(
      fc.property(springParamsArb, (params) => {
        const { spring } = simulateToSettling(params)
        return spring.isResting
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
        const config = defineSpring({
          mass: params.mass,
          tension: params.tension,
          damping: params.damping,
        })
        const displacement = params.value - params.target
        const est = config.computeTimeRemaining({ position: displacement, velocity: 0 })
        const dt = est / ITERATIONS

        const system = createSpringSystem()
        const spring = system.createSpring(params.value, config)
        spring.target = params.target

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
        const config = defineSpring({ mass, tension, damping })

        const s1 = system1.createSpring(displacement, config)
        s1.target = 0
        const s2 = system2.createSpring(-displacement, config)
        s2.target = 0

        const est = config.computeTimeRemaining({ position: displacement, velocity: 0 })
        const dt = est / ITERATIONS

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
        // zeta > 1 for overdamped
        dampingRatio: fc.double({ min: 1.5, max: 5, noNaN: true }),
        displacement: fc.double({ min: 10, max: 500, noNaN: true }),
      })
      .map(({ mass, tension, dampingRatio, displacement }) => {
        const cc = 2 * Math.sqrt(mass * tension)
        return { mass, tension, damping: dampingRatio * cc, displacement }
      })

    fc.assert(
      fc.property(overdampedArb, ({ mass, tension, damping, displacement }) => {
        const config = defineSpring({ mass, tension, damping })
        const system = createSpringSystem()
        const spring = system.createSpring(displacement, config)
        spring.target = 0

        const est = config.computeTimeRemaining({ position: displacement, velocity: 0 })
        const dt = est / ITERATIONS

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
        // zeta < 1 for underdamped
        dampingRatio: fc.double({ min: 0.1, max: 0.9, noNaN: true }),
        displacement: fc.double({ min: 10, max: 200, noNaN: true }),
      })
      .map(({ mass, tension, dampingRatio, displacement }) => {
        const cc = 2 * Math.sqrt(mass * tension)
        return { mass, tension, damping: dampingRatio * cc, displacement }
      })

    fc.assert(
      fc.property(underdampedArb, ({ mass, tension, damping, displacement }) => {
        const config = defineSpring({ mass, tension, damping })
        const system = createSpringSystem()
        const spring = system.createSpring(displacement, config)
        spring.target = 0

        const est = config.computeTimeRemaining({ position: displacement, velocity: 0 })
        const dt = est / ITERATIONS

        function energy() {
          const pos = spring.value
          const vel = spring.velocity
          return 0.5 * mass * vel * vel + 0.5 * tension * pos * pos
        }

        // Sample the energy every 10 ticks to smooth out noise.
        const energies: number[] = []
        for (let i = 0; i < ITERATIONS; i++) {
          if (i % 10 === 0) energies.push(energy())
          system.advance(dt)
        }

        let decreases = 0
        for (let i = 1; i < energies.length; i++) {
          if (energies[i]! < energies[i - 1]! + 0.01) decreases++
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
          const config = defineSpring({
            mass: params.mass,
            tension: params.tension,
            damping: params.damping,
          })
          const system = createSpringSystem()
          const spring = system.createSpring(params.value, config)
          spring.target = params.target

          // Run for a fraction of the solved rest time.
          const initialEst = config.computeTimeRemaining({
            position: params.value - params.target,
            velocity: 0,
          })
          const warmupDt = initialEst / ITERATIONS
          for (let i = 0; i < 60; i++) system.advance(warmupDt)

          spring.target = newTarget

          // Solve the new rest time from the current state.
          const newEst = config.computeTimeRemaining({
            position: spring.value - newTarget,
            velocity: spring.velocity,
          })
          const dt = newEst / ITERATIONS

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
