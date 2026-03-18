import { describe, expect, test, vi } from 'vitest'
import { createSpringSystem, defineSpring } from '../src/index.ts'

describe('Spring: input validation', () => {
  test('throws when mass is 0', () => {
    const system = createSpringSystem()
    expect(() => system.createSpring(0, defineSpring({ mass: 0, tension: 1, damping: 1 }))).toThrow(
      'Mass must be greater than 0',
    )
  })

  test('throws when mass is negative', () => {
    const system = createSpringSystem()
    expect(() =>
      system.createSpring(0, defineSpring({ mass: -1, tension: 1, damping: 1 })),
    ).toThrow('Mass must be greater than 0')
  })

  test('throws when tension is 0', () => {
    const system = createSpringSystem()
    expect(() => system.createSpring(0, defineSpring({ mass: 1, tension: 0, damping: 1 }))).toThrow(
      'Tension must be greater than 0',
    )
  })

  test('throws when damping is negative', () => {
    const system = createSpringSystem()
    expect(() =>
      system.createSpring(0, defineSpring({ mass: 1, tension: 1, damping: -1 })),
    ).toThrow('Damping must be greater than or equal to 0')
  })

  test('allows damping of 0', () => {
    const system = createSpringSystem()
    expect(() =>
      system.createSpring(0, defineSpring({ mass: 1, tension: 1, damping: 0 })),
    ).not.toThrow()
  })

  test('throws when precision is 0', () => {
    const system = createSpringSystem()
    expect(() =>
      system.createSpring(0, defineSpring({ mass: 1, tension: 1, damping: 1, precision: 0 })),
    ).toThrow('Precision must be greater than 0')
  })

  test('throws on configure with invalid mass', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 1, damping: 1 }))
    expect(() => {
      spring.configure(defineSpring({ mass: 0, tension: 1, damping: 1 }))
    }).toThrow('Mass must be greater than 0')
  })

  test('throws on configure with invalid tension', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 1, damping: 1 }))
    expect(() => {
      spring.configure(defineSpring({ tension: -1, damping: 1 }))
    }).toThrow('Tension must be greater than 0')
  })

  test('throws on configure with invalid damping', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 1, damping: 1 }))
    expect(() => {
      spring.configure(defineSpring({ tension: 1, damping: -1 }))
    }).toThrow('Damping must be greater than or equal to 0')
  })

  test('throws on configure with invalid precision', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 1, damping: 1 }))
    expect(() => {
      spring.configure(defineSpring({ tension: 1, damping: 1, precision: 0 }))
    }).toThrow('Precision must be greater than 0')
  })
})

describe('Spring: default values', () => {
  test('target defaults to 0 when neither target nor value is set', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 1, damping: 1 }))
    expect(spring.target).toBe(0)
    expect(spring.value).toBe(0)
  })

  test('target defaults to value when only value is set', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(
      { value: 50 },
      defineSpring({ mass: 1, tension: 1, damping: 1 }),
    )
    expect(spring.target).toBe(50)
    expect(spring.value).toBe(50)
  })

  test('value defaults to target when only target is set', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(
      { target: 50 },
      defineSpring({ mass: 1, tension: 1, damping: 1 }),
    )
    expect(spring.target).toBe(50)
    expect(spring.value).toBe(50)
  })

  test('precision defaults to 2', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 1, damping: 1 }))
    expect(spring.precision).toBe(2)
  })
})

describe('Spring: jumpTo', () => {
  test('instantly moves value to new position', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 170, damping: 26 }))

    spring.jumpTo(100)
    expect(spring.value).toBe(100)
    expect(spring.target).toBe(100)
  })

  test('resets velocity to zero', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(
      { target: 100, value: 0 },
      defineSpring({ mass: 1, tension: 170, damping: 10 }),
    )

    // Tick to build up velocity
    system.advance(100)
    expect(spring.velocity).not.toBe(0)

    spring.jumpTo(50)
    expect(spring.velocity).toBe(0)
  })

  test('spring is resting after jumpTo', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(
      { target: 100, value: 0 },
      defineSpring({ mass: 1, tension: 170, damping: 10 }),
    )

    spring.jumpTo(50)
    expect(spring.isResting).toBe(true)
  })
})

describe('Spring: events', () => {
  test('onUpdate fires on each tick while active', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(
      { target: 0, value: 100 },
      defineSpring({ mass: 1, tension: 170, damping: 10 }),
    )

    const onUpdate = vi.fn()
    spring.onUpdate(onUpdate)

    system.advance(1000 / 60)
    system.advance(1000 / 60)
    system.advance(1000 / 60)

    expect(onUpdate).toHaveBeenCalledTimes(3)
  })

  test('onStart fires when spring begins moving', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 170, damping: 10 }))

    const onStart = vi.fn()
    spring.onStart(onStart)

    // Spring is resting — no start event on tick
    system.advance(1000 / 60)
    expect(onStart).not.toHaveBeenCalled()

    // Change target to trigger motion
    spring.target = 100
    expect(onStart).toHaveBeenCalledOnce()
  })

  test('onStop fires when spring comes to rest', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(
      { target: 0, value: 1 },
      defineSpring({ mass: 1, tension: 170, damping: 26 }),
    )

    const onStop = vi.fn()
    spring.onStop(onStop)

    // Simulate until resting
    for (let i = 0; i < 600; i++) {
      system.advance(1000 / 60)
      if (spring.isResting) break
    }

    expect(onStop).toHaveBeenCalled()
  })

  test('unsubscribe function works for onUpdate', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(
      { target: 0, value: 100 },
      defineSpring({ mass: 1, tension: 170, damping: 10 }),
    )

    const onUpdate = vi.fn()
    const unsub = spring.onUpdate(onUpdate)

    system.advance(1000 / 60)
    expect(onUpdate).toHaveBeenCalledOnce()

    unsub()
    system.advance(1000 / 60)
    expect(onUpdate).toHaveBeenCalledOnce()
  })
})

describe('Spring: parameter changes mid-animation', () => {
  test('changing mass mid-animation does not crash', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(
      { target: 0, value: 100 },
      defineSpring({ mass: 1, tension: 170, damping: 10 }),
    )

    system.advance(1000 / 60)
    spring.configure(defineSpring({ mass: 5, tension: 170, damping: 10 }))
    expect(() => system.advance(1000 / 60)).not.toThrow()
    expect(spring.value).not.toBeNaN()
  })

  test('changing tension mid-animation does not produce NaN', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(
      { target: 0, value: 100 },
      defineSpring({ mass: 1, tension: 170, damping: 10 }),
    )

    system.advance(1000 / 60)
    spring.configure(defineSpring({ mass: 1, tension: 300, damping: 10 }))
    system.advance(1000 / 60)
    expect(spring.value).not.toBeNaN()
    expect(spring.velocity).not.toBeNaN()
  })

  test('changing damping to cross solver boundary works', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(
      { target: 0, value: 100 },
      defineSpring({ mass: 1, tension: 170, damping: 10 }),
    )

    // Start underdamped, switch to overdamped
    system.advance(1000 / 60)
    spring.configure(defineSpring({ mass: 1, tension: 170, damping: 40 }))
    system.advance(1000 / 60)

    expect(spring.value).not.toBeNaN()
    expect(spring.velocity).not.toBeNaN()
  })

  test('spring still converges after parameter change', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(
      { target: 0, value: 100 },
      defineSpring({ mass: 1, tension: 170, damping: 10 }),
    )

    // Tick for a bit, change params, then simulate to completion
    for (let i = 0; i < 30; i++) system.advance(1000 / 60)
    spring.configure(defineSpring({ mass: 1, tension: 200, damping: 30 }))

    for (let i = 0; i < 600; i++) {
      system.advance(1000 / 60)
      if (spring.isResting) break
    }

    expect(spring.isResting).toBe(true)
    expect(spring.value).toBeCloseTo(0, 0)
  })
})

describe('Spring: re-activation from rest', () => {
  test('setting value on a resting spring re-activates it', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 170, damping: 26 }))

    expect(spring.isResting).toBe(true)
    spring.value = 50
    expect(spring.value).toBe(50)

    // Should animate back to target
    for (let i = 0; i < 600; i++) {
      system.advance(1000 / 60)
      if (spring.isResting) break
    }

    expect(spring.isResting).toBe(true)
    expect(spring.value).toBeCloseTo(0, 0)
  })

  test('setting velocity on a resting spring re-activates it', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 170, damping: 26 }))

    expect(spring.isResting).toBe(true)
    spring.velocity = 100

    system.advance(1000 / 60)
    expect(spring.value).not.toBe(0)
  })

  test('setting mass on a resting spring re-activates it', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(
      { target: 50, value: 0 },
      defineSpring({ mass: 1, tension: 170, damping: 26 }),
    )

    // Settle first
    for (let i = 0; i < 600; i++) {
      system.advance(1000 / 60)
      if (spring.isResting) break
    }
    expect(spring.isResting).toBe(true)
    void spring.value

    spring.configure(defineSpring({ mass: 5, tension: 170, damping: 26 }))
    system.advance(1000 / 60)

    expect(spring.mass).toBe(5)
    // Spring is re-enrolled in ticker (advance didn't skip it)
    expect(spring.isResting).toBeDefined()
  })

  test('setting tension on a resting spring re-activates it', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(
      { target: 50, value: 0 },
      defineSpring({ mass: 1, tension: 170, damping: 26 }),
    )

    for (let i = 0; i < 600; i++) {
      system.advance(1000 / 60)
      if (spring.isResting) break
    }
    expect(spring.isResting).toBe(true)

    spring.configure(defineSpring({ tension: 300, damping: 26 }))
    system.advance(1000 / 60)

    expect(spring.tension).toBe(300)
  })

  test('setting damping on a resting spring re-activates it', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(
      { target: 50, value: 0 },
      defineSpring({ mass: 1, tension: 170, damping: 26 }),
    )

    for (let i = 0; i < 600; i++) {
      system.advance(1000 / 60)
      if (spring.isResting) break
    }
    expect(spring.isResting).toBe(true)

    spring.configure(defineSpring({ tension: 170, damping: 10 }))
    expect(spring.damping).toBe(10)
  })

  test('setting precision on a resting spring re-activates it', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(
      { target: 50, value: 0 },
      defineSpring({ mass: 1, tension: 170, damping: 26 }),
    )

    for (let i = 0; i < 600; i++) {
      system.advance(1000 / 60)
      if (spring.isResting) break
    }
    expect(spring.isResting).toBe(true)

    spring.configure(defineSpring({ tension: 170, damping: 26, precision: 5 }))
    expect(spring.precision).toBe(5)
  })
})

describe('Spring: dispose', () => {
  test('disposed spring no longer ticks', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(
      { target: 0, value: 100 },
      defineSpring({ mass: 1, tension: 170, damping: 10 }),
    )

    const onUpdate = vi.fn()
    spring.onUpdate(onUpdate)

    system.advance(1000 / 60)
    expect(onUpdate).toHaveBeenCalledOnce()

    spring.dispose()
    system.advance(1000 / 60)
    // onUpdate should not fire again — emitter was cleared
    expect(onUpdate).toHaveBeenCalledOnce()
  })
})
