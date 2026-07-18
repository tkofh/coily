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
    expect(config.computeTimeRemaining({ position: 0.002, velocity: 0 })).toBe(0)
    expect(config.computeTimeRemaining({ position: 0.005, velocity: 0 })).toBe(0)
  })

  test('returns nonzero when displacement exceeds threshold', () => {
    const config = defineSpring({ mass: 1, tension: 100, damping: 10 })
    expect(config.computeTimeRemaining({ position: 0.02, velocity: 0 })).toBeGreaterThan(0)
  })

  test('returns Infinity for zero damping', () => {
    const config = defineSpring({ mass: 1, tension: 100, damping: 0 })
    expect(config.computeTimeRemaining({ position: 50, velocity: 0 })).toBe(Infinity)
  })

  test('estimated time is an upper bound across every damping regime', () => {
    const wn = Math.sqrt(170)
    const configs = {
      underdamped: defineSpring({ mass: 1, tension: 170, damping: 10 }),
      critical: defineSpring({ mass: 1, tension: 170, damping: 2 * wn }),
      overdamped: defineSpring({ mass: 1, tension: 170, damping: 40 }),
    }

    for (const [regime, config] of Object.entries(configs)) {
      const est = config.computeTimeRemaining({ position: 100, velocity: 0 })

      const system = createSpringSystem()
      const spring = system.createSpring(100, config)
      spring.target = 0

      let t = 0
      const dt = 1000 / 60
      while (t < est && !spring.isResting) {
        system.advance(dt)
        t += dt
      }

      expect(spring.isResting, `${regime} should rest within its estimate`).toBe(true)
    }
  })

  test('the solved time is tight against brute force in every regime', () => {
    const configs = {
      'bouncy (zeta 0.1)': defineSpring({ tension: 300, bounce: 0.9 }),
      'underdamped (zeta 0.3)': defineSpring({ tension: 170, dampingRatio: 0.3 }),
      'underdamped (zeta 0.7)': defineSpring({ tension: 170, dampingRatio: 0.7 }),
      critical: defineSpring({ tension: 170, dampingRatio: 1 }),
      overdamped: defineSpring({ tension: 170, dampingRatio: 2 }),
    }

    for (const [regime, config] of Object.entries(configs)) {
      const solved = config.computeTimeRemaining({ position: 100, velocity: 0 })

      const system = createSpringSystem()
      const spring = system.createSpring(100, config)
      spring.target = 0

      let actual = 0
      while (!spring.isResting && actual < 60_000) {
        system.advance(0.5)
        actual += 0.5
      }

      // Never later than the solved time (within a step), and at most
      // one pulse earlier — the fine stepping catches the first dip.
      expect(actual, `${regime} rests by the solved time`).toBeLessThanOrEqual(solved + 0.5)
      expect(solved, `${regime} solved time is tight`).toBeLessThanOrEqual(actual * 1.1)
    }
  })

  test('duration tuning and computeTimeRemaining invert each other', () => {
    for (const dampingRatio of [0.3, 0.5, 1, 2]) {
      const config = defineSpring({ duration: 750, dampingRatio, displacement: 100 })
      expect(config.computeTimeRemaining({ position: 100, velocity: 0 })).toBeCloseTo(750, 4)
    }
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
