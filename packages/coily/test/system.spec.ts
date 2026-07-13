import { describe, expect, vi } from 'vitest'
import { createSpringSystem, defineSpring } from '../src/index.ts'
import { test } from './helpers.ts'

describe('SpringSystem', () => {
  test('single tick() updates all active springs', ({ system }) => {
    const config = defineSpring({ mass: 1, tension: 170, damping: 10 })

    const a = system.createSpring(0, config)
    a.target = 100
    const b = system.createSpring(0, config)
    b.target = -50

    system.advance(1000 / 60)

    // Both should have moved from their initial values
    expect(a.value).not.toBe(0)
    expect(b.value).not.toBe(0)
  })

  test('resting springs are not ticked', ({ system }) => {
    const config = defineSpring({ mass: 1, tension: 170, damping: 10 })

    const resting = system.createSpring(0, config)
    const active = system.createSpring(0, config)
    active.target = 100

    const restingUpdate = vi.fn()
    const activeUpdate = vi.fn()
    resting.onUpdate(restingUpdate)
    active.onUpdate(activeUpdate)

    system.advance(1000 / 60)

    expect(restingUpdate).not.toHaveBeenCalled()
    expect(activeUpdate).toHaveBeenCalled()
  })

  test('springs that come to rest are removed from scheduler', ({ system }) => {
    const spring = system.createSpring(1, defineSpring({ mass: 1, tension: 170, damping: 26 }))
    spring.target = 0

    const onStop = vi.fn()
    spring.onStop(onStop)

    // Simulate until rest
    for (let i = 0; i < 600; i++) {
      system.advance(1000 / 60)
      if (spring.isResting) break
    }

    expect(onStop).toHaveBeenCalled()

    // Subsequent ticks should not fire update
    const onUpdate = vi.fn()
    spring.onUpdate(onUpdate)
    system.advance(1000 / 60)
    expect(onUpdate).not.toHaveBeenCalled()
  })

  test('setting target re-adds a resting spring to the scheduler', ({ system }) => {
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 170, damping: 26 }))

    expect(spring.isResting).toBe(true)

    const onUpdate = vi.fn()
    spring.onUpdate(onUpdate)

    // Not being ticked
    system.advance(1000 / 60)
    expect(onUpdate).not.toHaveBeenCalled()

    // Set new target — should re-enter scheduler
    spring.target = 100
    system.advance(1000 / 60)
    expect(onUpdate).toHaveBeenCalled()
  })

  test('multiple springs reach their different targets independently', ({ system }) => {
    const config = defineSpring({ mass: 1, tension: 170, damping: 26 })

    const a = system.createSpring(0, config)
    a.target = 100
    const b = system.createSpring(0, config)
    b.target = -200
    const c = system.createSpring(50, config)

    for (let i = 0; i < 600; i++) {
      system.advance(1000 / 60)
      if (a.isResting && b.isResting && c.isResting) break
    }

    expect(a.value).toBeCloseTo(100, 0)
    expect(b.value).toBeCloseTo(-200, 0)
    expect(c.value).toBeCloseTo(50, 0)
  })
})

describe('SpringSystem: advance', () => {
  test('rejects a non-finite dt', ({ system }) => {
    expect(() => system.advance(Number.NaN)).toThrow('dt must be a finite number of milliseconds')
    expect(() => system.advance(Number.POSITIVE_INFINITY)).toThrow(
      'dt must be a finite number of milliseconds',
    )
  })

  test('a negative dt steps the simulation backward and reversibly', ({ system }) => {
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 170, damping: 10 }))
    spring.target = 100

    system.advance(1000 / 60)
    const forward = spring.value
    expect(forward).toBeGreaterThan(0)

    // The closed-form solver evaluates at absolute time, so reversing the exact
    // step lands back on the same trajectory point — no drift, no NaN.
    system.advance(-1000 / 60)
    expect(spring.value).toBeCloseTo(0, 6)
    expect(spring.value).toBeLessThan(forward)
    expect(Number.isFinite(spring.velocity)).toBe(true)
  })
})

describe('SpringSystem: transport controls', () => {
  test('not running by default', ({ system }) => {
    expect(system.running).toBe(false)
  })

  test('running is true after start()', ({ system }) => {
    system.start()
    expect(system.running).toBe(true)
    system.stop()
  })

  test('running is false after stop()', ({ system }) => {
    system.start()
    system.stop()
    expect(system.running).toBe(false)
  })

  test('start() is idempotent', ({ system }) => {
    system.start()
    system.start()
    expect(system.running).toBe(true)
    system.stop()
  })

  test('stop() is idempotent', ({ system }) => {
    system.stop()
    expect(system.running).toBe(false)
  })
})

describe('SpringSystem: ticker options', () => {
  // The Ticker's own behavior (capping, lag clamping, validation) is covered
  // exhaustively in ticker.spec.ts; here we only confirm the system exposes
  // and forwards the options.
  test('defaults match the ticker defaults', ({ system }) => {
    expect(system.fps).toBe(0)
    expect(system.lagThreshold).toBe(500)
    expect(system.adjustedLag).toBe(33)
  })

  test('threads options through the constructor and exposes them read/write', () => {
    const system = createSpringSystem({ fps: 30, lagThreshold: 1000, adjustedLag: 50 })
    expect(system.fps).toBe(30)
    expect(system.lagThreshold).toBe(1000)
    expect(system.adjustedLag).toBe(50)

    system.fps = 120
    system.lagThreshold = 250
    system.adjustedLag = 16
    expect(system.fps).toBe(120)
    expect(system.lagThreshold).toBe(250)
    expect(system.adjustedLag).toBe(16)
  })
})
