import { describe, expect, test } from 'vitest'
import { invariant, roundTo, settlingTime } from '../src/util'
import { createSpringSystem } from '../src/index'

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

describe('roundTo', () => {
  test('rounds to specified decimal places', () => {
    expect(roundTo(1.23456, 2)).toBe(1.23)
    expect(roundTo(1.23456, 3)).toBe(1.235)
    expect(roundTo(1.23456, 0)).toBe(1)
  })

  test('rounds 0.5 up', () => {
    expect(roundTo(1.235, 2)).toBe(1.24)
    expect(roundTo(1.5, 0)).toBe(2)
  })

  test('handles negative numbers', () => {
    expect(roundTo(-1.23456, 2)).toBe(-1.23)
  })

  test('handles zero', () => {
    expect(roundTo(0, 5)).toBe(0)
  })
})

describe('settlingTime', () => {
  test('returns 0 when displacement is at or below threshold', () => {
    expect(settlingTime({ mass: 1, tension: 100, damping: 10, displacement: 0 })).toBe(0)
    expect(settlingTime({ mass: 1, tension: 100, damping: 10, displacement: 0.005 })).toBe(0)
    expect(settlingTime({ mass: 1, tension: 100, damping: 10, displacement: 0.01 })).toBe(0)
  })

  test('returns nonzero when displacement exceeds threshold', () => {
    expect(settlingTime({ mass: 1, tension: 100, damping: 10, displacement: 0.02 })).toBeGreaterThan(0)
  })

  test('returns Infinity for zero damping', () => {
    expect(settlingTime({ mass: 1, tension: 100, damping: 0, displacement: 50 })).toBe(Infinity)
  })

  test('estimated time is an upper bound for underdamped spring', () => {
    const params = { mass: 1, tension: 170, damping: 10 }
    const displacement = 100
    const est = settlingTime({ ...params, displacement })

    const system = createSpringSystem()
    const spring = system.createSpring({ ...params, target: 0, value: displacement })

    let t = 0
    const dt = 1000 / 60
    while (t < est * 1000 && !spring.resting) {
      system.advance(dt)
      t += dt
    }

    expect(spring.resting).toBe(true)
  })

  test('estimated time is an upper bound for critically damped spring', () => {
    const wn = Math.sqrt(170)
    const cc = 2 * wn
    const params = { mass: 1, tension: 170, damping: cc }
    const displacement = 100
    const est = settlingTime({ ...params, displacement })

    const system = createSpringSystem()
    const spring = system.createSpring({ ...params, target: 0, value: displacement })

    let t = 0
    const dt = 1000 / 60
    while (t < est * 1000 && !spring.resting) {
      system.advance(dt)
      t += dt
    }

    expect(spring.resting).toBe(true)
  })

  test('estimated time is an upper bound for overdamped spring', () => {
    const params = { mass: 1, tension: 170, damping: 40 }
    const displacement = 100
    const est = settlingTime({ ...params, displacement })

    const system = createSpringSystem()
    const spring = system.createSpring({ ...params, target: 0, value: displacement })

    let t = 0
    const dt = 1000 / 60
    while (t < est * 1000 && !spring.resting) {
      system.advance(dt)
      t += dt
    }

    expect(spring.resting).toBe(true)
  })

  test('larger displacement produces longer settling time', () => {
    const params = { mass: 1, tension: 170, damping: 10 }
    const small = settlingTime({ ...params, displacement: 10 })
    const large = settlingTime({ ...params, displacement: 100 })
    expect(large).toBeGreaterThan(small)
  })

  test('higher damping ratio produces shorter settling time (underdamped regime)', () => {
    const low = settlingTime({ mass: 1, tension: 170, damping: 5, displacement: 100 })
    const high = settlingTime({ mass: 1, tension: 170, damping: 20, displacement: 100 })
    expect(high).toBeLessThan(low)
  })
})
