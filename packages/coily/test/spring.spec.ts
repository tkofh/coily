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

  test('allows precision 0 (resting threshold of 0.5)', () => {
    const system = createSpringSystem()
    expect(() =>
      system.createSpring(0, defineSpring({ mass: 1, tension: 1, damping: 1, precision: 0 })),
    ).not.toThrow()
  })

  test('throws when precision is negative', () => {
    expect(() => defineSpring({ mass: 1, tension: 1, damping: 1, precision: -1 })).toThrow(
      'Precision must be greater than or equal to 0',
    )
  })

  test('throws on config set with invalid mass', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 1, damping: 1 }))
    expect(() => {
      spring.config = defineSpring({ mass: 0, tension: 1, damping: 1 })
    }).toThrow('Mass must be greater than 0')
  })

  test('throws on config set with invalid tension', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 1, damping: 1 }))
    expect(() => {
      spring.config = defineSpring({ tension: -1, damping: 1 })
    }).toThrow('Tension must be greater than 0')
  })

  test('throws on config set with invalid damping', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 1, damping: 1 }))
    expect(() => {
      spring.config = defineSpring({ tension: 1, damping: -1 })
    }).toThrow('Damping must be greater than or equal to 0')
  })

  test('throws on config set with negative precision', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 1, damping: 1 }))
    expect(() => {
      spring.config = defineSpring({ tension: 1, damping: 1, precision: -1 })
    }).toThrow('Precision must be greater than or equal to 0')
  })

  // The following shapes are rejected by the types too — the casts simulate
  // untyped (plain JS) callers, who should get a clear error instead of a
  // silently ignored or misinterpreted parameter.
  test('throws when mass accompanies tension, damping, and dampingRatio', () => {
    expect(() =>
      defineSpring({ mass: 2, tension: 170, damping: 26, dampingRatio: 1 } as never),
    ).toThrow('mass is derived when tension, damping, and dampingRatio are all provided')
  })

  test('throws when mass accompanies a tension + duration config', () => {
    expect(() =>
      defineSpring({ mass: 2, tension: 170, dampingRatio: 1, duration: 500 } as never),
    ).toThrow('mass is derived in duration-based configs with tension')
  })

  test('throws when mass accompanies a damping + duration config', () => {
    expect(() =>
      defineSpring({ mass: 2, damping: 26, dampingRatio: 1, duration: 500 } as never),
    ).toThrow('mass is derived in duration-based configs with damping')
  })

  test('throws when both dampingRatio and bounce are provided', () => {
    expect(() => defineSpring({ tension: 170, dampingRatio: 1, bounce: 0.2 } as never)).toThrow(
      'Provide either dampingRatio or bounce, not both',
    )
  })
})

describe('Spring: default values', () => {
  test('target defaults to 0 when neither target nor value is set', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 1, damping: 1 }))
    expect(spring.target).toBe(0)
    expect(spring.value).toBe(0)
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
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 170, damping: 10 }))
    spring.target = 100

    // Tick to build up velocity
    system.advance(100)
    expect(spring.velocity).not.toBe(0)

    spring.jumpTo(50)
    expect(spring.velocity).toBe(0)
  })

  test('spring is resting after jumpTo', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 170, damping: 10 }))
    spring.target = 100

    spring.jumpTo(50)
    expect(spring.isResting).toBe(true)
  })
})

describe('Spring: events', () => {
  test('onUpdate fires on each tick while active', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(100, defineSpring({ mass: 1, tension: 170, damping: 10 }))
    spring.target = 0

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

  test('onStart does not fire again when retargeted mid-flight', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 170, damping: 26 }))

    const onStart = vi.fn()
    spring.onStart(onStart)

    spring.target = 100
    system.advance(1000 / 60)
    spring.target = 200
    system.advance(1000 / 60)
    spring.target = 300
    system.advance(1000 / 60)

    expect(onStart).toHaveBeenCalledOnce()
  })

  test('onStart fires again after the spring comes to rest', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 170, damping: 26 }))

    const onStart = vi.fn()
    spring.onStart(onStart)

    spring.target = 100
    for (let i = 0; i < 600; i++) {
      system.advance(1000 / 60)
      if (spring.isResting) break
    }
    expect(spring.isResting).toBe(true)

    spring.target = 200
    expect(onStart).toHaveBeenCalledTimes(2)
  })

  test('setting velocity on a resting spring fires onStart', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 170, damping: 26 }))

    const onStart = vi.fn()
    spring.onStart(onStart)

    spring.velocity = 500
    expect(onStart).toHaveBeenCalledOnce()
  })

  test('onConfigure fires on resolved config changes and not on no-ops', () => {
    const system = createSpringSystem()
    const config = defineSpring({ mass: 1, tension: 170, damping: 26 })
    const spring = system.createSpring(0, config)

    const onConfigure = vi.fn()
    spring.onConfigure(onConfigure)

    spring.config = config
    expect(onConfigure).not.toHaveBeenCalled()

    spring.config = defineSpring({ mass: 1, tension: 300, damping: 30 })
    expect(onConfigure).toHaveBeenCalledOnce()

    spring.config = null
    expect(onConfigure).toHaveBeenCalledTimes(2)
  })

  test('start and stop alternate strictly across interruptions', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 170, damping: 26 }))

    const events: string[] = []
    spring.onStart(() => events.push('start'))
    spring.onStop(() => events.push('stop'))

    // Two full animation cycles, with a mid-flight interruption in the first
    spring.target = 100
    for (let i = 0; i < 30; i++) system.advance(1000 / 60)
    spring.target = 50
    for (let i = 0; i < 600; i++) {
      system.advance(1000 / 60)
      if (spring.isResting) break
    }
    spring.target = 200
    for (let i = 0; i < 600; i++) {
      system.advance(1000 / 60)
      if (spring.isResting) break
    }

    expect(events).toEqual(['start', 'stop', 'start', 'stop'])
  })

  test('jumpTo on a resting spring does not fire onStop', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 170, damping: 26 }))

    const onStop = vi.fn()
    spring.onStop(onStop)

    spring.jumpTo(100)
    system.advance(1000 / 60)

    expect(onStop).not.toHaveBeenCalled()
  })

  test('retargeting does not emit update synchronously', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 170, damping: 26 }))

    const onUpdate = vi.fn()
    spring.onUpdate(onUpdate)

    // A retarget preserves the current value — no update until a real tick
    spring.target = 100
    expect(onUpdate).not.toHaveBeenCalled()

    system.advance(1000 / 60)
    expect(onUpdate).toHaveBeenCalledOnce()
  })

  test('jumpTo interrupting a moving spring fires onStop', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 170, damping: 26 }))

    const onStop = vi.fn()
    spring.onStop(onStop)

    spring.target = 100
    system.advance(1000 / 60)
    spring.jumpTo(100)

    expect(onStop).toHaveBeenCalledOnce()
  })

  test('onStop fires when spring comes to rest', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(1, defineSpring({ mass: 1, tension: 170, damping: 26 }))
    spring.target = 0

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
    const spring = system.createSpring(100, defineSpring({ mass: 1, tension: 170, damping: 10 }))
    spring.target = 0

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
    const spring = system.createSpring(100, defineSpring({ mass: 1, tension: 170, damping: 10 }))
    spring.target = 0

    system.advance(1000 / 60)
    spring.config = defineSpring({ mass: 5, tension: 170, damping: 10 })
    expect(() => system.advance(1000 / 60)).not.toThrow()
    expect(spring.value).not.toBeNaN()
  })

  test('changing tension mid-animation does not produce NaN', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(100, defineSpring({ mass: 1, tension: 170, damping: 10 }))
    spring.target = 0

    system.advance(1000 / 60)
    spring.config = defineSpring({ mass: 1, tension: 300, damping: 10 })
    system.advance(1000 / 60)
    expect(spring.value).not.toBeNaN()
    expect(spring.velocity).not.toBeNaN()
  })

  test('changing damping to cross solver boundary works', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(100, defineSpring({ mass: 1, tension: 170, damping: 10 }))
    spring.target = 0

    // Start underdamped, switch to overdamped
    system.advance(1000 / 60)
    spring.config = defineSpring({ mass: 1, tension: 170, damping: 40 })
    system.advance(1000 / 60)

    expect(spring.value).not.toBeNaN()
    expect(spring.velocity).not.toBeNaN()
  })

  test('spring still converges after parameter change', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(100, defineSpring({ mass: 1, tension: 170, damping: 10 }))
    spring.target = 0

    // Tick for a bit, change params, then simulate to completion
    for (let i = 0; i < 30; i++) system.advance(1000 / 60)
    spring.config = defineSpring({ mass: 1, tension: 200, damping: 30 })

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
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 170, damping: 26 }))
    spring.target = 50

    // Settle first
    for (let i = 0; i < 600; i++) {
      system.advance(1000 / 60)
      if (spring.isResting) break
    }
    expect(spring.isResting).toBe(true)
    void spring.value

    spring.config = defineSpring({ mass: 5, tension: 170, damping: 26 })
    system.advance(1000 / 60)

    expect(spring.mass).toBe(5)
    // Spring is re-enrolled in ticker (advance didn't skip it)
    expect(spring.isResting).toBeDefined()
  })

  test('setting tension on a resting spring re-activates it', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 170, damping: 26 }))
    spring.target = 50

    for (let i = 0; i < 600; i++) {
      system.advance(1000 / 60)
      if (spring.isResting) break
    }
    expect(spring.isResting).toBe(true)

    spring.config = defineSpring({ tension: 300, damping: 26 })
    system.advance(1000 / 60)

    expect(spring.tension).toBe(300)
  })

  test('setting damping on a resting spring re-activates it', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 170, damping: 26 }))
    spring.target = 50

    for (let i = 0; i < 600; i++) {
      system.advance(1000 / 60)
      if (spring.isResting) break
    }
    expect(spring.isResting).toBe(true)

    spring.config = defineSpring({ tension: 170, damping: 10 })
    expect(spring.damping).toBe(10)
  })

  test('setting precision on a resting spring re-activates it', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 170, damping: 26 }))
    spring.target = 50

    for (let i = 0; i < 600; i++) {
      system.advance(1000 / 60)
      if (spring.isResting) break
    }
    expect(spring.isResting).toBe(true)

    spring.config = defineSpring({ tension: 170, damping: 26, precision: 5 })
    expect(spring.precision).toBe(5)
  })
})

describe('Spring: dispose', () => {
  test('disposed spring no longer ticks', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(100, defineSpring({ mass: 1, tension: 170, damping: 10 }))
    spring.target = 0

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

describe('Spring: config value semantics', () => {
  test('assigning a config to a default-config spring does not affect other default-config springs', () => {
    const system = createSpringSystem()
    const a = system.createSpring(0)
    const b = system.createSpring(0)
    const tensionBefore = b.tension

    a.config = defineSpring({ tension: 500, damping: 5 })

    expect(a.tension).toBe(500)
    expect(b.tension).toBe(tensionBefore)
  })

  test('springs constructed with a shared config instance are not coupled', () => {
    const system = createSpringSystem()
    const shared = defineSpring({ mass: 1, tension: 100, damping: 10 })
    const a = system.createSpring(0, shared)
    const b = system.createSpring(0, shared)

    a.config = defineSpring({ mass: 1, tension: 300, damping: 10 })

    expect(a.tension).toBe(300)
    expect(b.tension).toBe(100)
    expect(shared.tension).toBe(100)
  })

  test('assigning a config does not mutate the assigned instance', () => {
    const system = createSpringSystem()
    const original = defineSpring({ mass: 1, tension: 100, damping: 10 })
    const spring = system.createSpring(0, original)

    spring.config = defineSpring({ mass: 1, tension: 300, damping: 10 })
    spring.config = null

    expect(original.tension).toBe(100)
  })

  test('config instances are frozen', () => {
    const config = defineSpring({ mass: 1, tension: 100, damping: 10 })

    expect(Object.isFrozen(config)).toBe(true)
  })

  test('setting config to null on a default-config spring keeps the default', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0)
    const tensionBefore = spring.tension

    spring.config = null

    expect(spring.tension).toBe(tensionBefore)
  })
})

describe('Spring: settled promise', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve))

  test('resolves immediately when already resting', async () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 170, damping: 26 }))

    await expect(spring.settled).resolves.toBeUndefined()
  })

  test('returns the same promise instance while moving', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 170, damping: 26 }))

    spring.target = 100
    expect(spring.settled).toBe(spring.settled)
  })

  test('stays pending across retargets and resolves at true rest', async () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 170, damping: 26 }))

    spring.target = 100
    let resolved = false
    spring.settled.then(() => {
      resolved = true
    })

    for (let i = 0; i < 10; i++) system.advance(1000 / 60)
    spring.target = 200
    for (let i = 0; i < 10; i++) system.advance(1000 / 60)
    await flush()
    expect(resolved).toBe(false)

    for (let i = 0; i < 600; i++) {
      system.advance(1000 / 60)
      if (spring.isResting) break
    }
    await flush()
    expect(resolved).toBe(true)
  })

  test('a new motion cycle gets a new promise', async () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 170, damping: 26 }))

    spring.target = 100
    const first = spring.settled
    for (let i = 0; i < 600; i++) {
      system.advance(1000 / 60)
      if (spring.isResting) break
    }
    await flush()

    spring.target = 200
    expect(spring.settled).not.toBe(first)
  })

  test('jumpTo resolves a pending promise', async () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 170, damping: 26 }))

    spring.target = 100
    const settled = spring.settled

    spring.jumpTo(100)
    await expect(settled).resolves.toBeUndefined()
  })

  test('dispose resolves a pending promise', async () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 170, damping: 26 }))

    spring.target = 100
    const settled = spring.settled

    spring.dispose()
    await expect(settled).resolves.toBeUndefined()
  })
})

describe('Spring: dispose', () => {
  test('onDispose fires when the spring is disposed', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 170, damping: 26 }))

    const onDispose = vi.fn()
    spring.onDispose(onDispose)

    spring.dispose()
    expect(onDispose).toHaveBeenCalledOnce()
  })

  test('double dispose is a no-op', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 170, damping: 26 }))
    spring.target = 100

    const onDispose = vi.fn()
    spring.onDispose(onDispose)

    spring.dispose()
    expect(() => spring.dispose()).not.toThrow()
    expect(onDispose).toHaveBeenCalledOnce()
  })

  test('a disposed spring freezes at its current value: reads work, writes throw', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, defineSpring({ mass: 1, tension: 170, damping: 26 }))

    spring.target = 100
    system.advance(1000 / 60)
    const frozen = spring.value

    spring.dispose()

    expect(spring.value).toBe(frozen)
    expect(() => {
      spring.target = 500
    }).toThrow('Cannot tick a disposed motion')
    expect(() => {
      spring.value = 5
    }).toThrow('Cannot tick a disposed motion')
    expect(() => spring.jumpTo(50)).toThrow('Cannot tick a disposed motion')
  })
})

describe('Spring: duration-based settle time', () => {
  test('settles at or before the requested duration when displacement matches the range', () => {
    for (const dampingRatio of [0.5, 1, 2]) {
      const system = createSpringSystem()
      const spring = system.createSpring(
        0,
        defineSpring({ duration: 750, dampingRatio, displacement: 300 }),
      )
      spring.target = 300

      let elapsed = 0
      while (!spring.isResting && elapsed < 5000) {
        system.advance(1000 / 60)
        elapsed += 1000 / 60
      }

      expect(spring.isResting).toBe(true)
      expect(elapsed).toBeLessThanOrEqual(750)
    }
  })
})

describe('Spring: retargeting preserves value', () => {
  test('repeated retarget round trips restore the value exactly', () => {
    const system = createSpringSystem({ reducedMotion: 'never' })
    const spring = system.createSpring(0)
    spring.target = 100
    for (let i = 0; i < 5; i++) {
      system.advance(1000 / 60) // mid-flight, position off the precision grid
    }

    // The regression this guards: rebasing through the rounded position fed
    // up to half a precision quantum into state per retarget, so retargeting
    // per pointermove (an off-grid target, then onward) drifted the value.
    const before = spring.value
    for (let i = 0; i < 8; i++) {
      spring.target = 77.7731
      spring.target = 100
    }
    expect(spring.value).toBe(before)
  })

  test('value lands exactly on a non-dyadic target at rest', () => {
    const system = createSpringSystem({ reducedMotion: 'never' })
    const spring = system.createSpring(0)
    spring.target = 77.7731

    for (let i = 0; i < 600 && !spring.isResting; i++) {
      system.advance(1000 / 60)
    }

    expect(spring.isResting).toBe(true)
    expect(spring.value).toBe(77.7731)
    expect(spring.velocity).toBe(0)
  })

  test('a soft spring is not declared resting while it can still move visibly', () => {
    const system = createSpringSystem({ reducedMotion: 'never' })
    // ωₙ = 0.1: near a zero crossing this spring satisfies the naive box
    // check (|x| and |v| both under the threshold) while its velocity can
    // still carry it ~10× the threshold away. The envelope must keep it
    // ticking through the crossing instead of snapping it to rest there.
    const spring = system.createSpring(
      1,
      defineSpring({ mass: 1, tension: 0.01, dampingRatio: 0.2, precision: 2 }),
    )
    spring.target = 0

    let crossedInsideBox = false
    let movedAfterward = false
    for (let i = 0; i < 50_000 && !spring.isResting; i++) {
      system.advance(1000 / 60)
      if (crossedInsideBox && Math.abs(spring.value) > 0.005) {
        movedAfterward = true
      }
      if (Math.abs(spring.value) < 0.005 && Math.abs(spring.velocity) < 0.005) {
        crossedInsideBox = true
      }
    }

    expect(spring.isResting).toBe(true)
    expect(crossedInsideBox).toBe(true)
    expect(movedAfterward).toBe(true)
  })
})
