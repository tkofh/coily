import { describe, expect, test } from 'vitest'
import { invariant } from '../src/util.ts'
import { createSpringSystem, defineSpring } from '../src/index.ts'

describe('invariant', () => {
  test('does not throw when condition is true', () => {
    expect(() => invariant(true)).not.toThrow()
  })

  test('does not throw for truthy values', () => {
    expect(() => invariant(1)).not.toThrow()
    expect(() => invariant('yes')).not.toThrow()
    expect(() => invariant({})).not.toThrow()
  })

  test('throws when condition is false', () => {
    expect(() => invariant(false)).toThrow('Invariant Failed')
  })

  test('throws with custom message', () => {
    expect(() => invariant(false, 'custom error')).toThrow('custom error')
  })

  test('throws for falsy values', () => {
    expect(() => invariant(0)).toThrow()
    expect(() => invariant('')).toThrow()
    expect(() => invariant(null)).toThrow()
    expect(() => invariant(undefined)).toThrow()
  })
})

describe('computeTimeRemaining', () => {
  test('returns 0 when displacement is at or below threshold', () => {
    const config = defineSpring({ mass: 1, tension: 100, damping: 10 })
    expect(config.computeTimeRemaining({ position: 0, velocity: 0 })).toBe(0)
    expect(config.computeTimeRemaining({ position: 0.005, velocity: 0 })).toBe(0)
    expect(config.computeTimeRemaining({ position: 0.01, velocity: 0 })).toBe(0)
  })

  test('returns nonzero when displacement exceeds threshold', () => {
    const config = defineSpring({ mass: 1, tension: 100, damping: 10 })
    expect(
      config.computeTimeRemaining({ position: 0.02, velocity: 0 }),
    ).toBeGreaterThan(0)
  })

  test('returns Infinity for zero damping', () => {
    const config = defineSpring({ mass: 1, tension: 100, damping: 0 })
    expect(config.computeTimeRemaining({ position: 50, velocity: 0 })).toBe(Infinity)
  })

  test('estimated time is an upper bound for underdamped spring', () => {
    const config = defineSpring({ mass: 1, tension: 170, damping: 10 })
    const est = config.computeTimeRemaining({ position: 100, velocity: 0 })

    const system = createSpringSystem()
    const spring = system.createSpring({ target: 0, value: 100 }, config)

    let t = 0
    const dt = 1000 / 60
    while (t < est && !spring.isResting) {
      system.advance(dt)
      t += dt
    }

    expect(spring.isResting).toBe(true)
  })

  test('estimated time is an upper bound for critically damped spring', () => {
    const wn = Math.sqrt(170)
    const cc = 2 * wn
    const config = defineSpring({ mass: 1, tension: 170, damping: cc })
    const est = config.computeTimeRemaining({ position: 100, velocity: 0 })

    const system = createSpringSystem()
    const spring = system.createSpring({ target: 0, value: 100 }, config)

    let t = 0
    const dt = 1000 / 60
    while (t < est && !spring.isResting) {
      system.advance(dt)
      t += dt
    }

    expect(spring.isResting).toBe(true)
  })

  test('estimated time is an upper bound for overdamped spring', () => {
    const config = defineSpring({ mass: 1, tension: 170, damping: 40 })
    const est = config.computeTimeRemaining({ position: 100, velocity: 0 })

    const system = createSpringSystem()
    const spring = system.createSpring({ target: 0, value: 100 }, config)

    let t = 0
    const dt = 1000 / 60
    while (t < est && !spring.isResting) {
      system.advance(dt)
      t += dt
    }

    expect(spring.isResting).toBe(true)
  })

  test('larger displacement produces longer settling time', () => {
    const config = defineSpring({ mass: 1, tension: 170, damping: 10 })
    const small = config.computeTimeRemaining({ position: 10, velocity: 0 })
    const large = config.computeTimeRemaining({ position: 100, velocity: 0 })
    expect(large).toBeGreaterThan(small)
  })

  test('higher damping ratio produces shorter settling time (underdamped regime)', () => {
    const low = defineSpring({ mass: 1, tension: 170, damping: 5 })
    const high = defineSpring({ mass: 1, tension: 170, damping: 20 })
    expect(high.computeTimeRemaining({ position: 100, velocity: 0 })).toBeLessThan(
      low.computeTimeRemaining({ position: 100, velocity: 0 }),
    )
  })
})
