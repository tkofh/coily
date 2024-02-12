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

  test('it freezes and unfreezes', ({ expect }) => {
    const spring = createSpring(10, { mass: 1, friction: 10, tension: 40 })

    spring.target = 0

    spring.simulate(10)

    expect(spring.velocity).toBeLessThan(0)

    const currentValue = spring.value

    spring.freeze()

    spring.simulate(10)

    expect(spring.value).toBe(currentValue)

    spring.unfreeze()

    expect(spring.state).toBe('moving')
  })

  test('it respects arrival behavior', ({ expect }) => {
    const normalSpring = createSpring(
      1,
      { mass: 1, friction: 1, tension: 120 },
      { arrivalBehavior: 1 }
    )
    const killedSpring = createSpring(
      1,
      { mass: 1, friction: 1, tension: 120 },
      { arrivalBehavior: 0 }
    )
    normalSpring.target = 0
    killedSpring.target = 0

    for (let i = 0; i < 100; i++) {
      normalSpring.simulate(10)
      killedSpring.simulate(10)

      if (killedSpring.state === 'resting') {
        expect(normalSpring.state).toBe('moving')
      }
    }
  })

  test('it allows current value to be set', ({ expect }) => {
    const spring = createSpring(0, { mass: 1, tension: 40, friction: 10 })

    spring.value = 5
    spring.simulate(60)
    expect(spring.value).toBeLessThan(5)
    expect(spring.state).toBe('moving')
    expect(Math.abs(spring.velocity)).toBeGreaterThan(0)
  })

  test('it allows velocity to be set', ({ expect }) => {
    const spring = createSpring(0, { mass: 1, tension: 40, friction: 10 })

    spring.velocity = 5
    spring.simulate(60)
    console.log(spring.value, spring.state, spring.velocity)
    expect(spring.value).toBeGreaterThan(0)
    expect(spring.state).toBe('moving')
    expect(Math.abs(spring.velocity)).toBeGreaterThan(0)
  })
})
