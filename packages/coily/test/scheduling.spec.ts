import { describe, expect, test } from 'vitest'
import { createSpringSystem } from '../src/api'

describe('scheduling', () => {
  test('handles state updates when updating target', () => {
    const system = createSpringSystem()

    const spring = system.createSpring({
      damping: 1,
      mass: 1,
      tension: 2,
      target: 0,
      value: 0,
    })

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
})
