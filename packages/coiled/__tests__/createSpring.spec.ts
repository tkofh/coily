import { describe, test, vi } from 'vitest'
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

  test('it emits events', ({ expect }) => {
    const spring = createSpring(5, { mass: 1, friction: 10, tension: 40 })

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const onUpdateValue = vi.fn(() => {})
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const onUpdateState = vi.fn(() => {})

    spring.on('update:value', onUpdateValue)
    spring.on('update:state', onUpdateState)

    spring.target = 10

    spring.simulate(1)
    spring.simulate(1)
    spring.simulate(1)

    expect(onUpdateValue).toHaveBeenCalledTimes(3)

    spring.freeze()
    spring.unfreeze()

    expect(onUpdateState).toHaveBeenCalledTimes(3)
  })
})
