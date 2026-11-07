import { afterEach, describe, expect, vi } from 'vitest'
import { createSpringSystem, defineSpring } from '../src/index.ts'
import { test } from './helpers.ts'

describe('SpringSystem', () => {
  test('a single advance() updates all active springs', ({ system }) => {
    const config = defineSpring({ mass: 1, tension: 170, damping: 10 })

    const a = system.createSpring(0, config)
    a.target = 100
    const b = system.createSpring(0, config)
    b.target = -50

    system.advance(1000 / 60)

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

    for (let i = 0; i < 600; i++) {
      system.advance(1000 / 60)
      if (spring.isResting) break
    }

    expect(onStop).toHaveBeenCalled()

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

    system.advance(1000 / 60)
    expect(onUpdate).not.toHaveBeenCalled()

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
  const message = 'dt must be a finite, non-negative number of milliseconds'

  test('rejects a non-finite dt', ({ system }) => {
    expect(() => system.advance(Number.NaN)).toThrow(message)
    expect(() => system.advance(Number.POSITIVE_INFINITY)).toThrow(message)
  })

  test('rejects a negative dt and changes nothing', ({ system }) => {
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 170, damping: 10 }))
    spring.target = 100
    const ramp = system.createRamp(0, { rate: 1000, target: Infinity })

    system.advance(1000 / 60)
    const value = spring.value
    const velocity = spring.velocity
    const position = ramp.value
    expect(value).toBeGreaterThan(0)
    expect(position).toBeGreaterThan(0)

    expect(() => system.advance(-1000 / 60)).toThrow(message)
    expect(() => system.advance(-Number.MIN_VALUE)).toThrow(message)
    expect(spring.value).toBe(value)
    expect(spring.velocity).toBe(velocity)
    expect(ramp.value).toBe(position)
  })

  test('accepts a dt of 0', ({ system }) => {
    const spring = system.createSpring(0)
    spring.target = 100
    system.advance(1000 / 60)
    const value = spring.value

    expect(() => system.advance(0)).not.toThrow()
    expect(spring.value).toBe(value)
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
  // ticker.spec.ts covers capping, lag clamping, and validation. These
  // tests confirm only that the system exposes and forwards the options.
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

  test('reads the lag settings back as written', () => {
    const system = createSpringSystem({ lagThreshold: 0, adjustedLag: 50 })
    expect(system.lagThreshold).toBe(0)
    expect(system.adjustedLag).toBe(50)

    system.lagThreshold = 10
    expect(system.adjustedLag).toBe(50)
    system.lagThreshold = 500
    expect(system.lagThreshold).toBe(500)
    expect(system.adjustedLag).toBe(50)
  })
})

describe('SpringSystem: dispose', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Counts live listeners per target, so a leak shows up as a nonzero count.
  function stubPage() {
    const live = { document: 0, media: 0 }
    const target = (key: keyof typeof live) => {
      const listeners = new Set<unknown>()
      return {
        addEventListener: (_type: string, listener: unknown) => {
          listeners.add(listener)
          live[key] = listeners.size
        },
        removeEventListener: (_type: string, listener: unknown) => {
          listeners.delete(listener)
          live[key] = listeners.size
        },
      }
    }
    const query = { matches: false, ...target('media') }
    vi.stubGlobal('window', {
      matchMedia: () => query,
      requestAnimationFrame: () => 0,
      cancelAnimationFrame: () => {},
    })
    vi.stubGlobal('document', { visibilityState: 'visible', ...target('document') })
    return live
  }

  test('removes the page listeners every system adds', () => {
    const live = stubPage()
    const systems = Array.from({ length: 3 }, () => createSpringSystem())
    expect(live).toEqual({ document: 3, media: 3 })

    for (const system of systems) {
      system.start()
      system.dispose()
    }
    expect(live).toEqual({ document: 0, media: 0 })
  })

  test('stops the system for good, and a second dispose is a no-op', () => {
    stubPage()
    const system = createSpringSystem()
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 170, damping: 26 }))
    spring.target = 100
    system.start()

    system.dispose()
    expect(system.running).toBe(false)
    expect(() => system.dispose()).not.toThrow()
    expect(() => system.start()).toThrow('Cannot start a disposed spring system')

    // Manual stepping needs no page listeners and still works.
    const before = spring.value
    system.advance(16)
    expect(spring.value).toBeGreaterThan(before)
  })
})
