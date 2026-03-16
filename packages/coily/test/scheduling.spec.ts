import { describe, expect, test, vi } from 'vitest'
import { createSpringSystem, springConfig } from '../src/index.ts'

describe('scheduling', () => {
  test('handles state updates when updating target', () => {
    const system = createSpringSystem()

    const spring = system.createSpring(0, springConfig({ damping: 1, mass: 1, tension: 2 }))

    expect(spring.target).toBe(0)
    expect(spring.value).toBe(0)
    expect(spring.resting).toBe(true)

    spring.target = 100

    expect(spring.target).toBe(100)
    expect(spring.value).toBe(0)
    expect(spring.resting).toBe(false)

    spring.target = 0

    expect(spring.target).toBe(0)
    expect(spring.value).toBe(0)
    expect(spring.resting).toBe(true)
  })

  test('emits start / stop / state change events', () => {
    const system = createSpringSystem()

    const spring = system.createSpring(0, springConfig({ damping: 1, mass: 1, tension: 2 }))

    const onStart = vi.fn()
    const onStop = vi.fn()
    spring.onStart(onStart)
    spring.onStop(onStop)

    expect(onStart).not.toHaveBeenCalled()
    expect(onStop).not.toHaveBeenCalled()

    spring.target = 100

    system.advance(0)

    expect(onStart).toHaveBeenCalled()
    expect(onStop).not.toHaveBeenCalled()

    spring.target = 0

    system.advance(0)

    expect(onStart).toHaveBeenCalled()
    expect(onStop).toHaveBeenCalled()
  })

  test('setting target and value to the same number leaves the spring resting', () => {
    const system = createSpringSystem()

    const spring = system.createSpring(0, springConfig({ damping: 1, mass: 1, tension: 2 }))

    system.advance(0)

    expect(spring.target).toBe(0)
    expect(spring.value).toBe(0)
    expect(spring.resting).toBe(true)

    spring.target = 100

    expect(spring.target).toBe(100)
    expect(spring.value).toBe(0)
    expect(spring.resting).toBe(false)

    spring.value = 100

    system.advance(0)

    expect(spring.target).toBe(100)
    expect(spring.value).toBe(100)
    expect(spring.resting).toBe(true)

    spring.value = 0

    expect(spring.target).toBe(100)
    expect(spring.value).toBe(0)
    expect(spring.resting).toBe(false)

    spring.target = 0

    system.advance(0)

    expect(spring.target).toBe(0)
    expect(spring.value).toBe(0)
    expect(spring.resting).toBe(true)
  })
})
