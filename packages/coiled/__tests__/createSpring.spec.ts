import { describe, test } from 'vitest'
import { createSpring } from '../src'

describe('createSpring', () => {
  test('it creates', ({ expect }) => {
    const spring = createSpring(5, { mass: 1, friction: 10, tension: 40 })
    expect(spring).toBeDefined()
  })
})
