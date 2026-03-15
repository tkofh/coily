import { describe, expect, test, vi } from 'vitest'
import { createSpringSystem } from '../src/index.ts'

describe('SpringSystem', () => {
  test('single tick() updates all active springs', () => {
    const system = createSpringSystem()

    const a = system.createSpring({ mass: 1, tension: 170, damping: 10, target: 100, value: 0 })
    const b = system.createSpring({ mass: 1, tension: 170, damping: 10, target: -50, value: 0 })

    system.advance(1000 / 60)

    // Both should have moved from their initial values
    expect(a.value).not.toBe(0)
    expect(b.value).not.toBe(0)
  })

  test('resting springs are not ticked', () => {
    const system = createSpringSystem()

    const resting = system.createSpring({ mass: 1, tension: 170, damping: 10, target: 0, value: 0 })
    const active = system.createSpring({
      mass: 1,
      tension: 170,
      damping: 10,
      target: 100,
      value: 0,
    })

    const restingUpdate = vi.fn()
    const activeUpdate = vi.fn()
    resting.onUpdate(restingUpdate)
    active.onUpdate(activeUpdate)

    system.advance(1000 / 60)

    expect(restingUpdate).not.toHaveBeenCalled()
    expect(activeUpdate).toHaveBeenCalled()
  })

  test('springs that come to rest are removed from scheduler', () => {
    const system = createSpringSystem()
    const spring = system.createSpring({
      mass: 1,
      tension: 170,
      damping: 26,
      target: 0,
      value: 1,
    })

    const onStop = vi.fn()
    spring.onStop(onStop)

    // Simulate until rest
    for (let i = 0; i < 600; i++) {
      system.advance(1000 / 60)
      if (spring.resting) break
    }

    expect(onStop).toHaveBeenCalled()

    // Subsequent ticks should not fire update
    const onUpdate = vi.fn()
    spring.onUpdate(onUpdate)
    system.advance(1000 / 60)
    expect(onUpdate).not.toHaveBeenCalled()
  })

  test('setting target re-adds a resting spring to the scheduler', () => {
    const system = createSpringSystem()
    const spring = system.createSpring({
      mass: 1,
      tension: 170,
      damping: 26,
      target: 0,
      value: 0,
    })

    expect(spring.resting).toBe(true)

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

  test('multiple springs reach their different targets independently', () => {
    const system = createSpringSystem()

    const a = system.createSpring({ mass: 1, tension: 170, damping: 26, target: 100, value: 0 })
    const b = system.createSpring({ mass: 1, tension: 170, damping: 26, target: -200, value: 0 })
    const c = system.createSpring({ mass: 1, tension: 170, damping: 26, target: 50, value: 50 })

    for (let i = 0; i < 600; i++) {
      system.advance(1000 / 60)
      if (a.resting && b.resting && c.resting) break
    }

    expect(a.value).toBeCloseTo(100, 0)
    expect(b.value).toBeCloseTo(-200, 0)
    expect(c.value).toBeCloseTo(50, 0)
  })
})

describe('SpringSystem: transport controls', () => {
  test('not running by default', () => {
    const system = createSpringSystem()
    expect(system.running).toBe(false)
  })

  test('running is true after start()', () => {
    const system = createSpringSystem()
    system.start()
    expect(system.running).toBe(true)
    system.stop()
  })

  test('running is false after stop()', () => {
    const system = createSpringSystem()
    system.start()
    system.stop()
    expect(system.running).toBe(false)
  })

  test('start() is idempotent', () => {
    const system = createSpringSystem()
    system.start()
    system.start()
    expect(system.running).toBe(true)
    system.stop()
  })

  test('stop() is idempotent', () => {
    const system = createSpringSystem()
    system.stop()
    expect(system.running).toBe(false)
  })
})

describe('SpringSystem: ticker options', () => {
  test('defaults fps to 60', () => {
    const system = createSpringSystem()
    expect(system.fps).toBe(60)
  })

  test('accepts fps via constructor options', () => {
    const system = createSpringSystem({ fps: 30 })
    expect(system.fps).toBe(30)
  })

  test('fps is writable at runtime', () => {
    const system = createSpringSystem()
    system.fps = 120
    expect(system.fps).toBe(120)
  })

  test('lagThreshold defaults to 500', () => {
    const system = createSpringSystem()
    expect(system.lagThreshold).toBe(500)
  })

  test('lagThreshold is writable at runtime', () => {
    const system = createSpringSystem()
    system.lagThreshold = 1000
    expect(system.lagThreshold).toBe(1000)
  })

  test('adjustedLag defaults to 33', () => {
    const system = createSpringSystem()
    expect(system.adjustedLag).toBe(33)
  })

  test('adjustedLag is writable at runtime', () => {
    const system = createSpringSystem()
    system.adjustedLag = 16
    expect(system.adjustedLag).toBe(16)
  })

  test('accepts all ticker options via constructor', () => {
    const system = createSpringSystem({ fps: 30, lagThreshold: 1000, adjustedLag: 50 })
    expect(system.fps).toBe(30)
    expect(system.lagThreshold).toBe(1000)
    expect(system.adjustedLag).toBe(50)
  })
})
