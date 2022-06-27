import { describe, test } from 'vitest'
import { createSystem } from '../src'

describe('createSystem', () => {
  test('it creates a system', ({ expect }) => {
    const system = createSystem()

    const config = {
      mass: 1,
      tension: 100,
      friction: 25,
    }

    const spring1 = system.createSpring(5, config)
    const spring2 = system.createSpring(5, config)

    spring1.target = 10
    spring2.target = 0

    expect(spring1.value).toBe(5)
    expect(spring2.value).toBe(5)

    system.simulate(16)

    expect(spring1.value).toBeGreaterThan(5)
    expect(spring2.value).toBeLessThan(5)
  })
})
