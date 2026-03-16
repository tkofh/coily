import { describe, expect, test } from 'vitest'
import { createSpringSystem, springConfig } from '../src/index.ts'

describe('initial conditions', () => {
  test('correct initial state with only target defined', () => {
    const system = createSpringSystem()

    const spring = system.createSpring(
      { target: 1 },
      springConfig({ damping: 1, mass: 1, tension: 1 }),
    )

    expect(spring.target).toBe(1)
    expect(spring.value).toBe(1)
  })

  test('correct initial state with only value defined', () => {
    const system = createSpringSystem()

    const spring = system.createSpring(
      { value: 1 },
      springConfig({ damping: 1, mass: 1, tension: 1 }),
    )

    expect(spring.target).toBe(1)
    expect(spring.value).toBe(1)
  })

  test('correct initial state with both target and value defined', () => {
    const system = createSpringSystem()

    const spring = system.createSpring(
      { target: 1, value: 1 },
      springConfig({ damping: 1, mass: 1, tension: 1 }),
    )

    expect(spring.target).toBe(1)
    expect(spring.value).toBe(1)
  })

  test('correct initial state with target and value as different values', () => {
    const system = createSpringSystem()

    const spring = system.createSpring(
      { target: 1, value: 2 },
      springConfig({ damping: 1, mass: 1, tension: 1 }),
    )

    expect(spring.target).toBe(1)
    expect(spring.value).toBe(2)
  })
})
