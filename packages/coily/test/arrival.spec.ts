import { describe, expect, vi } from 'vitest'
import fc from 'fast-check'
import { createSpringSystem, defineSpring } from '../src/index.ts'
import { FRAME, advanceUntilResting, flush, test } from './helpers.ts'

/**
 * The `arrival` multiplier: what a spring does to its velocity when the
 * value crosses the target. Crossings are solved in closed form, so the
 * pinned behaviors here are exact — a stop lands `toBe` the target with
 * no rendered overshoot at any step size, and rebounds never visit the
 * far side of the target.
 */

const bouncy = { tension: 300, bounce: 0.9 } as const
const stop = defineSpring({ ...bouncy, arrival: 'stop' })
const passthrough = defineSpring(bouncy)

describe('arrival: config resolution', () => {
  test('defaults to 1', () => {
    expect(defineSpring({ tension: 170, damping: 26 }).arrival).toBe(1)
    expect(defineSpring({ tension: 170, damping: 26, arrival: 'passthrough' }).arrival).toBe(1)
  })

  test("'stop' resolves to 0", () => {
    expect(stop.arrival).toBe(0)
  })

  test('numbers pass through, -0 normalized to 0', () => {
    expect(defineSpring({ ...bouncy, arrival: -0.75 }).arrival).toBe(-0.75)
    expect(Object.is(defineSpring({ ...bouncy, arrival: -0 }).arrival, 0)).toBe(true)
  })

  test('accepted alongside every input shape family', () => {
    expect(defineSpring({ mass: 2, tension: 170, damping: 26, arrival: 'stop' }).arrival).toBe(0)
    expect(defineSpring({ duration: 500, dampingRatio: 1, arrival: 'stop' }).arrival).toBe(0)
    expect(defineSpring({ damping: 26, bounce: 0.5, arrival: -1 }).arrival).toBe(-1)
  })

  test('the spring exposes its config arrival', ({ system }) => {
    expect(system.createSpring(0, stop).arrival).toBe(0)
    expect(system.createSpring(0).arrival).toBe(1)
  })

  test('rejects multipliers outside [-1, 1] and unknown names', () => {
    const message = "Arrival must be 'passthrough', 'stop', or a number between -1 and 1"
    expect(() => defineSpring({ ...bouncy, arrival: 1.5 })).toThrow(message)
    expect(() => defineSpring({ ...bouncy, arrival: -2 })).toThrow(message)
    expect(() => defineSpring({ ...bouncy, arrival: Number.NaN })).toThrow(message)
    expect(() => defineSpring({ ...bouncy, arrival: Infinity })).toThrow(message)
    expect(() => defineSpring({ ...bouncy, arrival: 'bounce' as never })).toThrow(message)
  })
})

describe('arrival: stop', () => {
  test('a bouncy spring stops dead on the target, never past it', ({ system }) => {
    const spring = system.createSpring(0, stop)
    spring.target = 100

    for (let i = 0; i < 600 && !spring.isResting; i++) {
      system.advance(FRAME)
      expect(spring.value).toBeLessThanOrEqual(100)
    }

    expect(spring.isResting).toBe(true)
    expect(spring.value).toBe(100)
    expect(spring.velocity).toBe(0)
  })

  test('a single huge step still lands exactly on the target', ({ system }) => {
    const spring = system.createSpring(0, stop)
    spring.target = 100

    system.advance(10_000)

    expect(spring.value).toBe(100)
    expect(spring.isResting).toBe(true)
  })

  test('stop fires once and settled resolves at the crossing', async ({ system }) => {
    const spring = system.createSpring(0, stop)
    const stops = vi.fn()
    spring.onStop(stops)

    spring.target = 100
    const settled = spring.settled.then(() => spring.value)
    advanceUntilResting(system, spring)
    await flush()

    expect(stops).toHaveBeenCalledTimes(1)
    await expect(settled).resolves.toBe(100)
  })

  test('an undamped spring rests at the crossing it would otherwise sail through', ({ system }) => {
    const config = defineSpring({ tension: 170, dampingRatio: 0, arrival: 'stop' })
    const spring = system.createSpring(0, config)
    spring.target = 100

    advanceUntilResting(system, spring)

    expect(spring.isResting).toBe(true)
    expect(spring.value).toBe(100)
    expect(config.computeTimeRemaining({ position: -100, velocity: 0 })).toBeLessThan(Infinity)
  })

  test('a fling from the target departs and stops on the return', ({ system }) => {
    const spring = system.createSpring(100, stop)
    spring.velocity = -800

    let min = 100
    for (let i = 0; i < 600 && !spring.isResting; i++) {
      system.advance(FRAME)
      min = Math.min(min, spring.value)
    }

    // A fling of -800 against wn = sqrt(300) dips |v| / wd, decay-shrunk:
    // well clear of the target, without a full traversal.
    expect(min).toBeLessThan(75)
    expect(spring.value).toBe(100)
    expect(spring.velocity).toBe(0)
  })
})

describe('arrival: regimes without a crossing', () => {
  test('an overdamped stop spring moves exactly like passthrough', ({ system }) => {
    const stopping = system.createSpring(
      0,
      defineSpring({ tension: 170, dampingRatio: 2, arrival: 'stop' }),
    )
    const passing = system.createSpring(0, defineSpring({ tension: 170, dampingRatio: 2 }))
    stopping.target = 100
    passing.target = 100

    for (let i = 0; i < 600; i++) {
      system.advance(FRAME)
      expect(stopping.value).toBe(passing.value)
    }

    expect(stopping.value).toBe(100)
  })

  test('critical damping without punch-through moves exactly like passthrough', ({ system }) => {
    const stopping = system.createSpring(
      0,
      defineSpring({ tension: 170, dampingRatio: 1, arrival: 'stop' }),
    )
    const passing = system.createSpring(0, defineSpring({ tension: 170, dampingRatio: 1 }))
    for (const spring of [stopping, passing]) {
      spring.target = 100
      spring.velocity = 500 // below the wn * 100 needed to punch through
    }

    for (let i = 0; i < 600; i++) {
      system.advance(FRAME)
      expect(stopping.value).toBe(passing.value)
    }

    expect(stopping.value).toBe(100)
  })

  test('critical damping with punch-through momentum stops at the target', ({ system }) => {
    const spring = system.createSpring(
      0,
      defineSpring({ tension: 170, dampingRatio: 1, arrival: 'stop' }),
    )
    spring.target = 100
    spring.velocity = 5000

    for (let i = 0; i < 600 && !spring.isResting; i++) {
      system.advance(FRAME)
      expect(spring.value).toBeLessThanOrEqual(100)
    }

    expect(spring.value).toBe(100)
    expect(spring.velocity).toBe(0)
  })
})

describe('arrival: rebound', () => {
  test('a rebounding spring bounces off the target without crossing it', ({ system }) => {
    const spring = system.createSpring(0, defineSpring({ ...bouncy, arrival: -0.5 }))
    spring.target = 100

    const velocities: number[] = []
    for (let i = 0; i < 600 && !spring.isResting; i++) {
      system.advance(FRAME)
      expect(spring.value).toBeLessThanOrEqual(100)
      velocities.push(spring.velocity)
    }

    let flips = 0
    for (let i = 1; i < velocities.length; i++) {
      if (Math.sign(velocities[i]!) !== Math.sign(velocities[i - 1]!)) flips++
    }

    expect(flips).toBeGreaterThanOrEqual(3)
    expect(spring.isResting).toBe(true)
    expect(spring.value).toBe(100)
  })

  test('an elastic rebound (-1) still rests through its damping', ({ system }) => {
    const spring = system.createSpring(
      0,
      defineSpring({ tension: 300, dampingRatio: 0.1, arrival: -1 }),
    )
    spring.target = 100

    advanceUntilResting(system, spring, 2000)

    expect(spring.isResting).toBe(true)
    expect(spring.value).toBe(100)
  })

  test('one giant step through a whole bounce sequence lands at rest on the target', ({
    system,
  }) => {
    const spring = system.createSpring(
      0,
      defineSpring({ tension: 300, dampingRatio: 0.05, arrival: -1 }),
    )
    spring.target = 100

    system.advance(60_000)

    expect(spring.isResting).toBe(true)
    expect(spring.value).toBe(100)
  })
})

describe('arrival: damped passthrough', () => {
  test('a multiplier in (0, 1) crosses slowed and overshoots less', ({ system }) => {
    const slowed = system.createSpring(0, defineSpring({ ...bouncy, arrival: 0.5 }))
    const passing = system.createSpring(0, passthrough)
    slowed.target = 100
    passing.target = 100

    let slowedMax = 0
    let passingMax = 0
    for (let i = 0; i < 600; i++) {
      system.advance(FRAME)
      slowedMax = Math.max(slowedMax, slowed.value)
      passingMax = Math.max(passingMax, passing.value)
    }

    expect(slowedMax).toBeGreaterThan(100)
    expect(slowedMax).toBeLessThan(passingMax)
    expect(slowed.value).toBe(100)
  })
})

describe('arrival: re-arming', () => {
  test('a mid-flight retarget stops at the new target instead', ({ system }) => {
    const spring = system.createSpring(0, stop)
    spring.target = 100
    for (let i = 0; i < 3; i++) system.advance(FRAME)

    spring.target = 50
    for (let i = 0; i < 600 && !spring.isResting; i++) {
      system.advance(FRAME)
      expect(spring.value).toBeLessThanOrEqual(50)
    }

    expect(spring.value).toBe(50)
  })

  test('a config swap after overshoot stops the swing back at the target', ({ system }) => {
    const spring = system.createSpring(0, passthrough)
    spring.target = 100
    for (let i = 0; i < 600 && spring.value <= 100; i++) system.advance(FRAME)
    expect(spring.value).toBeGreaterThan(100)

    spring.config = stop
    for (let i = 0; i < 600 && !spring.isResting; i++) {
      system.advance(FRAME)
      expect(spring.value).toBeGreaterThanOrEqual(100)
    }

    expect(spring.value).toBe(100)
  })
})

describe('arrival: timeRemaining', () => {
  test('a stop estimate matches the crossing found by brute force', () => {
    const estimate = stop.computeTimeRemaining({ position: -100, velocity: 0 })

    const system = createSpringSystem()
    const spring = system.createSpring(0, passthrough)
    spring.target = 100

    let elapsed = 0
    while (spring.value < 100 && elapsed < 1000) {
      system.advance(0.1)
      elapsed += 0.1
    }

    expect(estimate).toBeGreaterThan(elapsed - 0.2)
    expect(estimate).toBeLessThanOrEqual(elapsed + 0.2)
  })

  test('the crossing tightens the envelope estimate and the spring honors it', ({ system }) => {
    const state = { position: -100, velocity: 0 }
    const estimate = stop.computeTimeRemaining(state)
    expect(estimate).toBeLessThan(passthrough.computeTimeRemaining(state))

    const spring = system.createSpring(0, stop)
    spring.target = 100
    system.advance(estimate + FRAME)

    expect(spring.isResting).toBe(true)
    expect(spring.value).toBe(100)
  })

  test('a rebound tightens the time below the passthrough bound and honors it', ({ system }) => {
    const rebound = defineSpring({ ...bouncy, arrival: -0.5 })
    const state = { position: -100, velocity: 0 }
    const solved = rebound.computeTimeRemaining(state)
    expect(solved).toBeLessThan(passthrough.computeTimeRemaining(state))

    const spring = system.createSpring(0, rebound)
    spring.target = 100
    system.advance(solved + 2 * FRAME)

    expect(spring.isResting).toBe(true)
    expect(spring.value).toBe(100)
  })

  test('an undamped rebound reports a finite time and rests on the target', ({ system }) => {
    const config = defineSpring({ tension: 170, dampingRatio: 0, arrival: -0.5 })
    const solved = config.computeTimeRemaining({ position: -100, velocity: 0 })
    expect(solved).toBeLessThan(Infinity)

    const spring = system.createSpring(0, config)
    spring.target = 100
    system.advance(solved + 2 * FRAME)

    expect(spring.isResting).toBe(true)
    expect(spring.value).toBe(100)
  })
})

describe('arrival: composite springs', () => {
  test('applies per channel through a config shape', ({ system }) => {
    const spring = system.createSpring({ x: 0, y: 0 }, { x: stop, y: passthrough })
    spring.target = { x: 100, y: 100 }

    let yOvershot = false
    for (let i = 0; i < 600 && !spring.isResting; i++) {
      system.advance(FRAME)
      expect(spring.value.x).toBeLessThanOrEqual(100)
      if (spring.value.y > 100) yOvershot = true
    }

    expect(yOvershot).toBe(true)
    expect(spring.value.x).toBe(100)
    expect(spring.value.y).toBe(100)
  })
})

describe('arrival: property-based laws', () => {
  test('a stop spring never overshoots and rests exactly on its target', () => {
    fc.assert(
      fc.property(
        fc.record({
          tension: fc.double({ min: 10, max: 500, noNaN: true }),
          dampingRatio: fc.double({ min: 0, max: 0.99, noNaN: true }),
          displacement: fc.double({ min: 1, max: 500, noNaN: true }),
          sign: fc.constantFrom(1, -1),
        }),
        ({ tension, dampingRatio, displacement, sign }) => {
          const config = defineSpring({ tension, dampingRatio, arrival: 'stop' })
          const system = createSpringSystem()
          const spring = system.createSpring(sign * displacement, config)
          spring.target = 0

          const budget = config.computeTimeRemaining({
            position: sign * displacement,
            velocity: 0,
          })
          let frames = Math.ceil(budget / FRAME) + 10
          while (frames-- > 0 && !spring.isResting) {
            system.advance(FRAME)
            if (spring.value * sign < 0) return false
          }
          return spring.isResting && spring.value === 0
        },
      ),
      { numRuns: 200 },
    )
  })

  test('a rebounding spring never visits the far side of its target', () => {
    fc.assert(
      fc.property(
        fc.record({
          tension: fc.double({ min: 10, max: 500, noNaN: true }),
          dampingRatio: fc.double({ min: 0.1, max: 0.9, noNaN: true }),
          arrival: fc.double({ min: -1, max: 0, noNaN: true }),
          displacement: fc.double({ min: 1, max: 500, noNaN: true }),
          sign: fc.constantFrom(1, -1),
        }),
        ({ tension, dampingRatio, arrival, displacement, sign }) => {
          const config = defineSpring({ tension, dampingRatio, arrival })
          const system = createSpringSystem()
          const spring = system.createSpring(sign * displacement, config)
          spring.target = 0

          for (let i = 0; i < 300 && !spring.isResting; i++) {
            system.advance(FRAME)
            if (spring.value * sign < 0) return false
          }
          return Number.isFinite(spring.value)
        },
      ),
      { numRuns: 200 },
    )
  })
})
