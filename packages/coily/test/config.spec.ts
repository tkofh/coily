import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { createSpringSystem, defineSpring, type SpringDefinition } from '../src/index.ts'

/**
 * Runs a spring from `displacement` away to rest on a 1 ms grid and
 * returns the first tick, in ms, at which it rests.
 */
function restTick(config: SpringDefinition, displacement: number): number {
  const system = createSpringSystem({ reducedMotion: 'never' })
  const spring = system.createSpring(0, config)
  spring.target = displacement
  let elapsed = 0
  while (!spring.isResting && elapsed < 10_000) {
    system.advance(1)
    elapsed += 1
  }
  return elapsed
}

describe('duration configs honor precision', () => {
  const precisions = [0, 2, 4]
  const displacements = [1, 300]

  test('a non-bouncy config rests at its duration at any precision', () => {
    for (const precision of precisions) {
      for (const displacement of displacements) {
        for (const dampingRatio of [1, 2]) {
          const tick = restTick(
            defineSpring({ duration: 500, dampingRatio, displacement, precision }),
            displacement,
          )
          expect(
            tick,
            `precision ${precision}, displacement ${displacement}`,
          ).toBeGreaterThanOrEqual(499)
          expect(tick, `precision ${precision}, displacement ${displacement}`).toBeLessThanOrEqual(
            501,
          )
        }
      }
    }
  })

  test('a bouncy config solves to its duration and rests no later', () => {
    for (const precision of precisions) {
      for (const displacement of displacements) {
        for (const bounce of [0.3, 0.5]) {
          const config = defineSpring({ duration: 500, bounce, displacement, precision })
          const label = `precision ${precision}, displacement ${displacement}, bounce ${bounce}`

          expect(
            config.computeTimeRemaining({ position: -displacement, velocity: 0 }),
            label,
          ).toBeCloseTo(500, 6)

          // An early rest catches a dip of the pulsing rest amplitude. It
          // comes at most ln(2 / (1 - zeta)) / (2 * sigma) before the
          // solved time.
          const sigma = config.dampingRatio * config.naturalFrequency
          const slack = (Math.log(2 / (1 - config.dampingRatio)) / (2 * sigma)) * 1000
          const tick = restTick(config, displacement)
          expect(tick, label).toBeGreaterThanOrEqual(500 - slack)
          expect(tick, label).toBeLessThanOrEqual(501)
        }
      }
    }
  })
})

describe('duration configs: displacement', () => {
  test('the magnitude must exceed the resting threshold', () => {
    expect(() =>
      defineSpring({ duration: 500, dampingRatio: 1, displacement: 0.4, precision: 0 }),
    ).toThrow(
      'Displacement magnitude must be greater than the resting threshold (0.5 at precision 0)',
    )
    expect(() => defineSpring({ duration: 500, dampingRatio: 1, displacement: 0 })).toThrow(
      'Displacement magnitude must be greater than the resting threshold (0.005 at precision 2)',
    )
    expect(() => defineSpring({ duration: 500, dampingRatio: 1, displacement: -0.005 })).toThrow(
      'Displacement magnitude must be greater than the resting threshold',
    )
  })

  test('the bound follows precision', () => {
    // 0.004 is inside the default threshold of 0.005, but well outside
    // 0.0005 at precision 3.
    const config = defineSpring({
      duration: 500,
      dampingRatio: 1,
      displacement: 0.004,
      precision: 3,
    })
    expect(config.computeTimeRemaining({ position: 0.004, velocity: 0 })).toBeCloseTo(500, 6)
  })

  test('the sign is ignored', () => {
    const positive = defineSpring({ duration: 500, dampingRatio: 0.7, displacement: 300 })
    const negative = defineSpring({ duration: 500, dampingRatio: 0.7, displacement: -300 })
    expect(negative.tension).toBe(positive.tension)
    expect(negative.damping).toBe(positive.damping)
  })
})

describe('bounce 1', () => {
  test('is rejected where tension or mass is derived from damping', () => {
    expect(() => defineSpring({ damping: 10, bounce: 1 })).toThrow(
      'bounce must be < 1 to derive tension',
    )
    expect(() => defineSpring({ tension: 170, damping: 10, bounce: 1 })).toThrow(
      'bounce must be < 1 to derive mass',
    )
  })

  test('is accepted everywhere else, and still settles', () => {
    const configs = [
      defineSpring({ tension: 170, bounce: 1 }),
      defineSpring({ duration: 500, bounce: 1 }),
      defineSpring({ tension: 170, duration: 500, bounce: 1 }),
      defineSpring({ damping: 10, duration: 500, bounce: 1 }),
    ]
    for (const config of configs) {
      expect(config.dampingRatio).toBeGreaterThan(0)
      expect(Number.isFinite(config.computeTimeRemaining({ position: 1, velocity: 0 }))).toBe(true)
    }
  })

  test('just below 1 is accepted where tension or mass is derived from damping', () => {
    expect(defineSpring({ damping: 10, bounce: 0.99 }).dampingRatio).toBeCloseTo(0.01, 12)
    expect(defineSpring({ tension: 170, damping: 10, bounce: 0.99 }).dampingRatio).toBeCloseTo(
      0.01,
      12,
    )
  })
})

describe('resolved parameters are usable', () => {
  // Every input shape at zero and near-zero damping, plus finite inputs
  // whose derived parameters overflow or underflow. Each must either throw
  // at construction or yield a config a spring can run.
  const inputs: Record<string, unknown>[] = []
  for (const damping of [0, Number.MIN_VALUE, 1e-300, 1e-12, 1]) {
    inputs.push(
      { tension: 100, damping },
      { damping, dampingRatio: 1 },
      { damping, bounce: 0.5 },
      { tension: 100, damping, dampingRatio: 1 },
      { tension: 100, damping, bounce: 0.5 },
      { damping, duration: 500, dampingRatio: 1 },
      { damping, duration: 500, bounce: 0.5 },
    )
  }
  for (const dampingRatio of [Number.MIN_VALUE, 1e-12, 1, 2]) {
    inputs.push(
      { tension: 100, dampingRatio },
      { dampingRatio, duration: 500 },
      { tension: 100, dampingRatio, duration: 500 },
    )
  }
  inputs.push(
    { tension: 1e300, damping: 1, mass: 1e-300 },
    { tension: 1e-300, damping: 1e300 },
    { tension: Number.MAX_VALUE, dampingRatio: 1 },
    { tension: 100, damping: 1, precision: 400 },
    { duration: Number.MIN_VALUE, dampingRatio: 1 },
    { duration: 1e300, dampingRatio: 1 },
  )

  for (const input of inputs) {
    test(`${JSON.stringify(input)} throws or runs`, () => {
      let config: SpringDefinition
      try {
        config = defineSpring(input as never)
      } catch (error) {
        expect((error as Error).message).not.toMatch(/undefined|Invariant Failed/)
        return
      }

      for (const key of ['mass', 'tension', 'naturalFrequency', 'restingMagnitude'] as const) {
        expect(config[key]).toBeGreaterThan(0)
        expect(config[key]).toBeLessThan(Infinity)
      }
      for (const key of ['damping', 'dampingRatio'] as const) {
        expect(config[key]).toBeGreaterThanOrEqual(0)
        expect(config[key]).toBeLessThan(Infinity)
      }

      const system = createSpringSystem({ reducedMotion: 'never' })
      const spring = system.createSpring(0, config)
      spring.target = 1
      system.advance(16)
      expect(Number.isFinite(spring.value)).toBe(true)
      expect(Number.isFinite(spring.velocity)).toBe(true)
      expect(Number.isNaN(spring.timeRemaining)).toBe(false)
    })
  }

  test('zero damping that would derive tension or mass names the cause', () => {
    expect(() => defineSpring({ damping: 0, dampingRatio: 1 })).toThrow(
      'damping must be > 0 to derive tension',
    )
    expect(() => defineSpring({ tension: 100, damping: 0, dampingRatio: 1 })).toThrow(
      'damping must be > 0 to derive mass',
    )
    expect(() => defineSpring({ damping: 0, duration: 500, dampingRatio: 1 })).toThrow(
      'damping must be > 0 to derive mass',
    )
  })

  test('zero damping stays valid where tension is given directly', () => {
    const config = defineSpring({ tension: 100, damping: 0 })
    expect(config.dampingRatio).toBe(0)
    expect(config.naturalFrequency).toBe(10)
  })
})

describe('duration tuning is continuous through critical damping', () => {
  const nearCritical = [
    1 - 1e-4,
    1 - 1e-8,
    1 - Number.EPSILON,
    1,
    1 + Number.EPSILON,
    1 + 1e-8,
    1 + 1e-4,
    1.001,
    1.01,
    2,
    10,
  ]

  test('a near-critical or non-bouncy config rests at its duration', () => {
    for (const dampingRatio of nearCritical) {
      for (const [displacement, precision] of [
        [1, 2],
        [300, 0],
        [300, 4],
      ] as const) {
        const config = defineSpring({ duration: 500, dampingRatio, displacement, precision })
        const label = `dampingRatio ${dampingRatio}, displacement ${displacement}, precision ${precision}`
        expect(
          config.computeTimeRemaining({ position: -displacement, velocity: 0 }),
          label,
        ).toBeCloseTo(500, 6)
        const tick = restTick(config, displacement)
        expect(tick, label).toBeGreaterThanOrEqual(499)
        expect(tick, label).toBeLessThanOrEqual(501)
      }
    }
  })

  test('adjacent ratios tune to adjacent stiffness and trajectories', () => {
    const critical = defineSpring({ duration: 500, dampingRatio: 1 })
    const sample = (config: SpringDefinition) => {
      const system = createSpringSystem({ reducedMotion: 'never' })
      const spring = system.createSpring(0, config)
      spring.target = 1
      system.advance(100)
      return spring.value
    }
    for (const dampingRatio of [1 - Number.EPSILON, 1 + Number.EPSILON]) {
      const config = defineSpring({ duration: 500, dampingRatio })
      expect(config.tension / critical.tension).toBeCloseTo(1, 6)
      expect(sample(config)).toBeCloseTo(sample(critical), 6)
    }
  })
})

describe('remaining time stays conservative near critical damping', () => {
  test('a spring from any state rests no later than its estimate', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(0.5, 0.9, 0.999, 1 - 1e-9, 1, 1 + 1e-9, 1.001, 1.5, 4),
        fc.double({ min: -300, max: 300, noNaN: true }),
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        (dampingRatio, position, velocity) => {
          const config = defineSpring({ tension: 170, dampingRatio })
          const estimate = config.computeTimeRemaining({ position, velocity })
          const system = createSpringSystem({ reducedMotion: 'never' })
          const spring = system.createSpring(0, config)
          // Value 0 against target -position leaves `position` to go.
          spring.target = -position
          spring.velocity = velocity
          let elapsed = 0
          while (!spring.isResting && elapsed < 20_000) {
            system.advance(1)
            elapsed++
          }
          expect(elapsed).toBeLessThanOrEqual(Math.ceil(estimate) + 1)
        },
      ),
      { numRuns: 300 },
    )
  })
})

describe('very large damping ratios', () => {
  test('a ratio of 1e8 still creeps toward its target', () => {
    const config = defineSpring({ tension: 1, damping: 2e8 })
    const system = createSpringSystem({ reducedMotion: 'never' })
    const spring = system.createSpring(0, config)
    spring.target = 1
    system.advance(1000)
    // The slow mode decays at about wn / (2 * ratio), so 1 s covers 5e-9.
    expect(spring.value).toBeCloseTo(5e-9, 15)
    expect(Number.isFinite(spring.timeRemaining)).toBe(true)
  })
})
