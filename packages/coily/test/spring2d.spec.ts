import { describe, expect, test, vi } from 'vitest'
import { createSpringSystem, defineSpring } from '../src/index.ts'

const config = defineSpring({ mass: 1, tension: 170, damping: 26 })

describe('Spring2D: creation', () => {
  test('creates at a Vector2 position', () => {
    const system = createSpringSystem()
    const spring = system.createSpring2D({ x: 10, y: 20 }, config)

    expect(spring.value).toEqual({ x: 10, y: 20 })
    expect(spring.target).toEqual({ x: 10, y: 20 })
  })

  test('creates with displaced position', () => {
    const system = createSpringSystem()
    const spring = system.createSpring2D(
      { target: { x: 100, y: 200 }, value: { x: 0, y: 0 } },
      config,
    )

    expect(spring.target).toEqual({ x: 100, y: 200 })
    expect(spring.value).toEqual({ x: 0, y: 0 })
  })

  test('value defaults to target when only target is set', () => {
    const system = createSpringSystem()
    const spring = system.createSpring2D({ target: { x: 50, y: 75 } }, config)

    expect(spring.target).toEqual({ x: 50, y: 75 })
    expect(spring.value).toEqual({ x: 50, y: 75 })
  })

  test('starts resting when value equals target', () => {
    const system = createSpringSystem()
    const spring = system.createSpring2D({ x: 10, y: 20 }, config)

    expect(spring.isResting).toBe(true)
  })

  test('starts active when value differs from target', () => {
    const system = createSpringSystem()
    const spring = system.createSpring2D(
      { target: { x: 100, y: 100 }, value: { x: 0, y: 0 } },
      config,
    )

    expect(spring.isResting).toBe(false)
  })
})

describe('Spring2D: simulation', () => {
  test('animates toward target', () => {
    const system = createSpringSystem()
    const spring = system.createSpring2D(
      { target: { x: 100, y: 200 }, value: { x: 0, y: 0 } },
      config,
    )

    system.advance(100)

    const { x, y } = spring.value
    expect(x).toBeGreaterThan(0)
    expect(x).toBeLessThan(100)
    expect(y).toBeGreaterThan(0)
    expect(y).toBeLessThan(200)
  })

  test('settles at target', () => {
    const system = createSpringSystem()
    const spring = system.createSpring2D(
      { target: { x: 100, y: 200 }, value: { x: 0, y: 0 } },
      config,
    )

    // Advance enough time for the spring to settle
    for (let i = 0; i < 120; i++) {
      system.advance(1000 / 60)
    }

    expect(spring.value).toEqual({ x: 100, y: 200 })
    expect(spring.isResting).toBe(true)
  })

  test('axes are independent', () => {
    const system = createSpringSystem()
    const spring = system.createSpring2D({ x: 0, y: 0 }, config)

    // Only move x
    spring.target = { x: 100, y: 0 }
    system.advance(100)

    expect(spring.value.x).not.toBe(0)
    expect(spring.value.y).toBe(0)
  })

  test('setting target mid-animation works', () => {
    const system = createSpringSystem()
    const spring = system.createSpring2D(
      { target: { x: 100, y: 100 }, value: { x: 0, y: 0 } },
      config,
    )

    system.advance(100)
    spring.target = { x: -50, y: -50 }

    for (let i = 0; i < 120; i++) {
      system.advance(1000 / 60)
    }

    expect(spring.value).toEqual({ x: -50, y: -50 })
    expect(spring.isResting).toBe(true)
  })
})

describe('Spring2D: properties', () => {
  test('velocity reflects motion on both axes', () => {
    const system = createSpringSystem()
    const spring = system.createSpring2D(
      { target: { x: 100, y: 200 }, value: { x: 0, y: 0 } },
      config,
    )

    system.advance(1000 / 60)

    expect(spring.velocity.x).not.toBe(0)
    expect(spring.velocity.y).not.toBe(0)
  })

  test('timeRemaining is the max of both axes', () => {
    const system = createSpringSystem()
    const spring = system.createSpring2D(
      { target: { x: 1, y: 1000 }, value: { x: 0, y: 0 } },
      config,
    )

    // y has a much larger displacement, so it should take longer
    expect(spring.timeRemaining).toBeGreaterThan(0)
  })

  test('config getters delegate to shared config', () => {
    const system = createSpringSystem()
    const c = defineSpring({ mass: 2, tension: 200, damping: 30 })
    const spring = system.createSpring2D({ x: 0, y: 0 }, c)

    expect(spring.mass).toBe(2)
    expect(spring.tension).toBe(200)
    expect(spring.damping).toBe(30)
    expect(spring.config).toBe(c)
  })
})

describe('Spring2D: jumpTo', () => {
  test('instantly moves to position', () => {
    const system = createSpringSystem()
    const spring = system.createSpring2D({ x: 0, y: 0 }, config)

    spring.jumpTo({ x: 50, y: 75 })

    expect(spring.value).toEqual({ x: 50, y: 75 })
    expect(spring.target).toEqual({ x: 50, y: 75 })
    expect(spring.isResting).toBe(true)
  })

  test('resets velocity to zero', () => {
    const system = createSpringSystem()
    const spring = system.createSpring2D(
      { target: { x: 100, y: 100 }, value: { x: 0, y: 0 } },
      config,
    )

    system.advance(100)
    expect(spring.velocity.x).not.toBe(0)

    spring.jumpTo({ x: 25, y: 25 })
    expect(spring.velocity).toEqual({ x: 0, y: 0 })
  })
})

describe('Spring2D: configure', () => {
  test('applies new config to both axes', () => {
    const system = createSpringSystem()
    const spring = system.createSpring2D(
      { target: { x: 100, y: 100 }, value: { x: 0, y: 0 } },
      config,
    )

    const newConfig = defineSpring({ mass: 1, tension: 500, damping: 50 })
    spring.config = newConfig

    system.advance(100)

    // With higher tension, the spring should move faster
    expect(spring.value.x).toBeGreaterThan(0)
  })
})

describe('Spring2D: events', () => {
  test('onUpdate fires while active', () => {
    const system = createSpringSystem()
    const spring = system.createSpring2D(
      { target: { x: 100, y: 100 }, value: { x: 0, y: 0 } },
      config,
    )

    const onUpdate = vi.fn()
    spring.onUpdate(onUpdate)

    system.advance(1000 / 60)

    expect(onUpdate).toHaveBeenCalled()
  })

  test('onStop fires when both axes come to rest', () => {
    const system = createSpringSystem()
    const spring = system.createSpring2D(
      { target: { x: 0, y: 0 }, value: { x: 1, y: 1 } },
      config,
    )

    const onStop = vi.fn()
    spring.onStop(onStop)

    // Advance until settled
    for (let i = 0; i < 120; i++) {
      system.advance(1000 / 60)
    }

    expect(onStop).toHaveBeenCalled()
    expect(spring.isResting).toBe(true)
  })

  test('onStart fires when motion begins', () => {
    const system = createSpringSystem()
    const spring = system.createSpring2D({ x: 0, y: 0 }, config)

    const onStart = vi.fn()
    spring.onStart(onStart)

    spring.target = { x: 100, y: 100 }

    expect(onStart).toHaveBeenCalled()
  })

  test('unsubscribe works', () => {
    const system = createSpringSystem()
    const spring = system.createSpring2D(
      { target: { x: 100, y: 100 }, value: { x: 0, y: 0 } },
      config,
    )

    const onUpdate = vi.fn()
    const unsub = spring.onUpdate(onUpdate)

    system.advance(1000 / 60)
    const callCount = onUpdate.mock.calls.length
    expect(callCount).toBeGreaterThan(0)

    unsub()
    system.advance(1000 / 60)

    expect(onUpdate.mock.calls.length).toBe(callCount)
  })
})

describe('Spring2D: dispose', () => {
  test('dispose stops the spring', () => {
    const system = createSpringSystem()
    const spring = system.createSpring2D(
      { target: { x: 100, y: 100 }, value: { x: 0, y: 0 } },
      config,
    )

    const onUpdate = vi.fn()
    spring.onUpdate(onUpdate)

    spring.dispose()
    system.advance(1000 / 60)

    expect(onUpdate).not.toHaveBeenCalled()
  })
})

describe('Spring2D: value and velocity setters', () => {
  test('setting value displaces the spring', () => {
    const system = createSpringSystem()
    const spring = system.createSpring2D({ x: 0, y: 0 }, config)

    spring.value = { x: 50, y: 50 }

    expect(spring.value).toEqual({ x: 50, y: 50 })
    expect(spring.target).toEqual({ x: 0, y: 0 })
    expect(spring.isResting).toBe(false)
  })

  test('setting velocity injects energy', () => {
    const system = createSpringSystem()
    const spring = system.createSpring2D({ x: 0, y: 0 }, config)

    spring.velocity = { x: 100, y: -100 }

    system.advance(1000 / 60)

    expect(spring.value.x).not.toBe(0)
    expect(spring.value.y).not.toBe(0)
  })
})
