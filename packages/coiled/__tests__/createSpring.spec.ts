import { describe, test } from 'vitest'
import { createSpring } from '../src'

describe('createSpring', () => {
  test('it creates a standalone spring', ({ expect }) => {
    const spring = createSpring(5, { mass: 1, friction: 10, tension: 40 })
    expect(spring.value).toBe(5)
    expect(spring.target).toBe(5)

    spring.target = 0
    spring.simulate(16)

    expect(spring.value).toBeLessThan(5)
  })
})
