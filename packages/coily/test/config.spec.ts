import { describe, expect, test } from 'vitest'
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
