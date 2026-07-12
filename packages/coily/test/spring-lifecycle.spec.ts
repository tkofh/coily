import { describe, expect, test } from 'vitest'
import { createSpringSystem, defineSpring } from '../src/index.ts'

describe('initial conditions', () => {
  test('a new spring rests at its value', () => {
    const system = createSpringSystem()

    const spring = system.createSpring(1, defineSpring({ damping: 1, mass: 1, tension: 1 }))

    expect(spring.target).toBe(1)
    expect(spring.value).toBe(1)
  })

  test('retargeting a new spring displaces it without moving its value', () => {
    const system = createSpringSystem()

    const spring = system.createSpring(2, defineSpring({ damping: 1, mass: 1, tension: 1 }))
    spring.target = 1

    expect(spring.target).toBe(1)
    expect(spring.value).toBe(2)
  })
})
