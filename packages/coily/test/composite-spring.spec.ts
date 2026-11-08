import { describe, expect, vi } from 'vitest'
import { SpringDefinition, defineSpring } from '../src/config.ts'
import { mapSpring } from '../src/spring-source.ts'
import type { CompositeSpring } from '../src/composite-spring.ts'
import { createSpringSystem } from '../src/system.ts'
import { FRAME, advanceUntilResting, flush, makeSource, test } from './helpers.ts'

const config = defineSpring({ mass: 1, tension: 170, damping: 26 })
const stiff = defineSpring({ tension: 1000, dampingRatio: 1 })
const gentle = defineSpring({ tension: 10, dampingRatio: 1 })

type Composite = CompositeSpring<{ position: { x: number; y: number }; color: number[] }>

describe('CompositeSpring: creation', () => {
  test('creates resting at the given value', ({ system }) => {
    const spring = system.createSpring({ position: { x: 10, y: 20 }, opacity: 1 }, config)

    expect(spring.value).toEqual({ position: { x: 10, y: 20 }, opacity: 1 })
    expect(spring.target).toEqual({ position: { x: 10, y: 20 }, opacity: 1 })
    expect(spring.isResting).toBe(true)
  })

  test('supports arrays as shapes', ({ system }) => {
    const spring = system.createSpring({ color: [255, 128, 0] }, config)

    expect(spring.value).toEqual({ color: [255, 128, 0] })
    expect(Array.isArray(spring.value.color)).toBe(true)
  })

  test('supports numeric keys', ({ system }) => {
    const spring = system.createSpring({ 0: 5, 1: 10 }, config)

    expect(spring.value).toEqual({ 0: 5, 1: 10 })
  })

  test('value, velocity, and target return stable cached objects', ({ system }) => {
    const spring = system.createSpring({ position: { x: 0, y: 0 } }, config)

    expect(spring.value).toBe(spring.value)
    expect(spring.value.position).toBe(spring.value.position)
    expect(spring.velocity).toBe(spring.velocity)
    expect(spring.target).toBe(spring.target)
  })

  test('does not alias the input object', ({ system }) => {
    const input = { x: 1, y: 2 }
    const spring = system.createSpring(input, config)

    input.x = 99

    expect(spring.value.x).toBe(1)
  })

  test('throws on non-numeric leaves', ({ system }) => {
    expect(() =>
      system.createSpring({ position: { x: 0, y: 'nope' as unknown as number } }, config),
    ).toThrow("Invalid value at 'position.y'")
  })

  test('throws on non-finite leaves with their path', ({ system }) => {
    expect(() => system.createSpring({ position: { x: Number.NaN, y: 0 } })).toThrow(
      "Invalid value at 'position.x': channel values must be finite",
    )
  })

  test('throws on empty shapes and empty subtrees', ({ system }) => {
    // The `Shape` constraint also rejects these at compile time; the casts
    // keep the runtime backstop covered for untyped callers.
    expect(() => system.createSpring({} as never)).toThrow('at least one channel')
    expect(() => system.createSpring({ position: {} } as never)).toThrow('at least one channel')
    expect(() => system.createSpring({ items: [] } as never)).toThrow('at least one channel')
  })

  test('throws on non-plain objects in the shape', ({ system }) => {
    expect(() => system.createSpring({ when: new Date() as unknown as number })).toThrow(
      "Invalid value at 'when'",
    )
  })

  test('throws when the whole value is not a plain object or array', ({ system }) => {
    // The composite checks the root container itself, so a non-container
    // value never reaches the shape tree.
    expect(() => system.createSpring(new Date() as unknown as Record<string, number>)).toThrow(
      'Composite spring value must be a plain object or an array of numeric channels',
    )
  })
})

describe('CompositeSpring: simulation', () => {
  test('animates every channel toward its target', ({ system }) => {
    const spring = system.createSpring({ position: { x: 0, y: 0 }, opacity: 0 }, config)

    spring.target = { position: { x: 100, y: 50 }, opacity: 1 }
    system.advance(100)

    expect(spring.value.position.x).toBeGreaterThan(0)
    expect(spring.value.position.x).toBeLessThan(100)
    expect(spring.value.position.y).toBeGreaterThan(0)
    expect(spring.value.opacity).toBeGreaterThan(0)
  })

  test('settles at the target', ({ system }) => {
    const spring = system.createSpring({ position: { x: 0, y: 0 }, opacity: 0 }, config)

    spring.target = { position: { x: 100, y: 50 }, opacity: 1 }
    for (let i = 0; i < 240 && !spring.isResting; i++) {
      system.advance(FRAME)
    }

    expect(spring.isResting).toBe(true)
    expect(spring.value).toEqual({ position: { x: 100, y: 50 }, opacity: 1 })
  })

  test('velocity reflects motion per channel', ({ system }) => {
    const spring = system.createSpring({ x: 0, y: 0 }, config)

    spring.target = { x: 100 }
    system.advance(FRAME)

    expect(spring.velocity.x).not.toBe(0)
    expect(spring.velocity.y).toBe(0)
  })

  test('timeRemaining is the max across channels', ({ system }) => {
    const spring = system.createSpring({ near: 0, far: 0 }, config)

    spring.target = { near: 1 }
    const nearOnly = spring.timeRemaining
    expect(nearOnly).toBeGreaterThan(0)

    spring.target = { far: 1000 }
    expect(spring.timeRemaining).toBeGreaterThan(nearOnly)
  })
})

describe('CompositeSpring: partial targets', () => {
  test('retargets only the given channels', ({ system }) => {
    const spring = system.createSpring({ position: { x: 0, y: 0 }, opacity: 1 }, config)

    spring.target = { opacity: 0 }

    expect(spring.target).toEqual({ position: { x: 0, y: 0 }, opacity: 0 })
    system.advance(100)
    expect(spring.value.position).toEqual({ x: 0, y: 0 })
    expect(spring.value.opacity).toBeLessThan(1)
  })

  test('partial arrays skip missing entries', ({ system }) => {
    const spring = system.createSpring({ color: [255, 128, 0] }, config)

    spring.target = { color: [0, undefined, 255] }

    expect(spring.target).toEqual({ color: [0, 128, 255] })
  })

  test('throws on unknown channels', ({ system }) => {
    const spring = system.createSpring({ position: { x: 0, y: 0 } }, config)

    expect(() => {
      spring.target = { position: { z: 5 } } as never
    }).toThrow("Unknown channel 'position.z'")
  })

  test('throws on out-of-range array indices', ({ system }) => {
    const spring = system.createSpring({ color: [0, 0, 0] }, config)

    expect(() => {
      spring.target = { color: [0, 0, 0, 0] } as never
    }).toThrow("Unknown channel 'color.3'")
  })

  test('throws on structure mismatches', ({ system }) => {
    const spring = system.createSpring({ position: { x: 0, y: 0 } }, config)

    expect(() => {
      spring.target = { position: 5 } as never
    }).toThrow("Expected an object at 'position'")
    expect(() => {
      spring.target = { position: { x: { deep: 1 } } } as never
    }).toThrow("Invalid value at 'position.x': expected a finite number or a scalar SpringSource")
    expect(() => {
      spring.value = { position: { x: { deep: 1 } } } as never
    }).toThrow("Expected a finite number for channel 'position.x'")
  })

  test('throws on non-finite channel writes with their path', ({ system }) => {
    const spring = system.createSpring({ position: { x: 0, y: 0 } }, config)

    expect(() => {
      spring.target = { position: { x: Number.NaN } }
    }).toThrow("Invalid value at 'position.x': expected a finite number or a scalar SpringSource")
    expect(() => {
      spring.value = { position: { x: Number.POSITIVE_INFINITY } }
    }).toThrow("Expected a finite number for channel 'position.x'")
  })
})

describe('CompositeSpring: failed writes', () => {
  // Each bad entry comes after a good one, so a write that applied as it
  // validated would already have moved the good channel when it threw.
  function setup(system: ReturnType<typeof createSpringSystem>) {
    const spring = system.createSpring({ position: { x: 0, y: 0 }, color: [0, 0] }, config)
    const events: string[] = []
    spring.onStart(() => events.push('start'))
    spring.onUpdate(() => events.push('update'))
    spring.onStop(() => events.push('stop'))
    const snapshot = () =>
      structuredClone({
        value: spring.value,
        target: spring.target,
        velocity: spring.velocity,
        config: spring.config,
        isResting: spring.isResting,
        events,
      })
    return { spring, snapshot }
  }

  test.for([
    ['target: unknown channel', { position: { x: 100, z: 1 } }, "Unknown channel 'position.z'"],
    [
      'target: unknown index',
      { position: { x: 100 }, color: [100, 100, 100] },
      "Unknown channel 'color.2'",
    ],
    ['target: non-finite channel', { position: { x: 100, y: Number.NaN } }, "'position.y'"],
    ['target: structure mismatch', { position: { x: 100 }, color: 5 }, "at 'color'"],
  ] as const)('%s throws and changes nothing', ([, write, message], { system }) => {
    const { spring, snapshot } = setup(system)
    const before = snapshot()

    expect(() => {
      spring.target = write as never
    }).toThrow(message)

    expect(snapshot()).toEqual(before)
    system.advance(FRAME)
    expect(snapshot()).toEqual(before)
  })

  test('a target naming a non-scalar source throws and changes nothing', ({ system }) => {
    const { spring, snapshot } = setup(system)
    const leader = system.createSpring(0, config)
    const before = snapshot()

    expect(() => {
      spring.target = { position: { x: leader, y: spring } } as never
    }).toThrow("Invalid value at 'position.y'")

    leader.target = 100
    for (let i = 0; i < 10; i++) system.advance(FRAME)
    expect(snapshot()).toEqual(before)
  })

  test('a target naming a source with a non-finite value throws and changes nothing', ({
    system,
  }) => {
    const { spring, snapshot } = setup(system)
    const leader = system.createSpring(0, config)
    const broken = makeSource(Number.NaN)
    const before = snapshot()

    expect(() => {
      spring.target = { position: { x: leader, y: broken.source } }
    }).toThrow("Invalid value at 'position.y'")

    leader.target = 100
    for (let i = 0; i < 10; i++) system.advance(FRAME)
    expect(snapshot()).toEqual(before)
  })

  test.for([
    [
      'value: non-finite channel',
      (spring: Composite) => (spring.value = { position: { x: 50, y: Number.NaN } }),
    ],
    [
      'velocity: non-finite channel',
      (spring: Composite) => (spring.velocity = { position: { x: 50, y: Number.NaN } }),
    ],
    [
      'jumpTo: non-finite channel',
      (spring: Composite) => spring.jumpTo({ position: { x: 50, y: Number.NaN } }),
    ],
    [
      'value: unknown channel',
      (spring: Composite) => (spring.value = { position: { x: 50 }, z: 1 } as never),
    ],
    [
      'velocity: unknown channel',
      (spring: Composite) => (spring.velocity = { position: { x: 50 }, z: 1 } as never),
    ],
    [
      'jumpTo: unknown channel',
      (spring: Composite) => spring.jumpTo({ position: { x: 50 }, z: 1 } as never),
    ],
  ] as const)('%s throws and changes nothing', ([, write], { system }) => {
    const { spring, snapshot } = setup(system)
    const before = snapshot()

    expect(() => write(spring)).toThrow()

    expect(snapshot()).toEqual(before)
    system.advance(FRAME)
    expect(snapshot()).toEqual(before)
  })

  test('a bad config write throws and changes nothing', ({ system }) => {
    const { spring, snapshot } = setup(system)
    const before = snapshot()

    expect(() => {
      spring.config = { position: { x: stiff, z: gentle } } as never
    }).toThrow("Unknown channel 'position.z' in config")
    expect(() => {
      spring.config = { position: stiff, color: [gentle, 5] } as never
    }).toThrow("Invalid config for 'color.1'")

    expect(spring.config).toBe(config)
    expect(snapshot()).toEqual(before)
  })

  test('following a leader of another shape throws and changes nothing', ({ system }) => {
    const follower = system.createSpring({ x: 0, y: 0 }, config)
    const leader = system.createSpring({ x: 0, z: 0 }, config)
    const onStart = vi.fn()
    follower.onStart(onStart)

    expect(() => {
      follower.target = leader as never
    }).toThrow('Shape mismatch')

    leader.target = { x: 100, z: 100 }
    for (let i = 0; i < 10; i++) system.advance(FRAME)
    expect(follower.target).toEqual({ x: 0, y: 0 })
    expect(follower.isResting).toBe(true)
    expect(onStart).not.toHaveBeenCalled()
  })
})

describe('CompositeSpring: config shapes', () => {
  test('a single config applies to every channel', ({ system }) => {
    const spring = system.createSpring({ x: 0, y: 0 }, config)

    expect(spring.config).toBe(config)
  })

  test('rejects a bare options object as a single config', ({ system }) => {
    // A bare options object reads as a config shape, so its option keys are
    // unknown channels.
    expect(() =>
      system.createSpring({ x: 0 }, { mass: 1, tension: 170, damping: 26 } as never),
    ).toThrow("Unknown channel 'mass'")
  })

  test('per-channel configs animate channels at different speeds', ({ system }) => {
    const spring = system.createSpring({ fast: 0, slow: 0 }, { fast: stiff, slow: gentle })

    spring.target = { fast: 100, slow: 100 }
    system.advance(100)

    expect(spring.value.fast).toBeGreaterThan(spring.value.slow)
    expect(spring.config).toBeNull()
  })

  test('a subtree config applies to every channel below it', ({ system }) => {
    const spring = system.createSpring(
      { position: { x: 0, y: 0 }, opacity: 0 },
      { position: stiff },
    )

    spring.target = { position: { x: 100, y: 100 }, opacity: 100 }
    system.advance(100)

    expect(spring.value.position.x).toBe(spring.value.position.y)
    expect(spring.value.position.x).toBeGreaterThan(spring.value.opacity)
  })

  test('setting config to null reverts all channels to the default', ({ system }) => {
    const spring = system.createSpring({ x: 0, y: 0 }, config)

    spring.config = null

    expect(spring.config).toBe(SpringDefinition.default)
  })

  test('a partial config shape leaves unmentioned channels alone', ({ system }) => {
    const spring = system.createSpring({ x: 0, y: 0 }, config)

    spring.config = { x: stiff }

    expect(spring.config).toBeNull()
    spring.target = { x: 100, y: 100 }
    system.advance(100)
    expect(spring.value.x).not.toBe(spring.value.y)
  })

  test('rejects a numeric leaf in a config shape', ({ system }) => {
    // A plain object is a config shape, so its leaves must be configs, even
    // at a channel named like a spring option.
    expect(() =>
      system.createSpring({ tension: 0, damping: 0 }, { tension: 170, damping: 26 } as never),
    ).toThrow("Invalid config for 'tension'")
  })

  test('throws on config keys that are not channels', ({ system }) => {
    expect(() => system.createSpring({ x: 0 }, { opacityy: config } as never)).toThrow(
      "Unknown channel 'opacityy'",
    )
  })
})

describe('CompositeSpring: coalesced events', () => {
  test('onUpdate fires exactly once per frame while several channels move', ({ system }) => {
    const spring = system.createSpring({ position: { x: 0, y: 0 }, opacity: 0 }, config)
    spring.target = { position: { x: 100, y: 100 }, opacity: 1 }

    const onUpdate = vi.fn()
    spring.onUpdate(onUpdate)

    system.advance(FRAME)
    expect(onUpdate).toHaveBeenCalledTimes(1)

    system.advance(FRAME)
    expect(onUpdate).toHaveBeenCalledTimes(2)
  })

  test('onStart fires synchronously and once when several channels start together', ({
    system,
  }) => {
    const spring = system.createSpring({ x: 0, y: 0 }, config)

    const onStart = vi.fn()
    spring.onStart(onStart)

    spring.target = { x: 100, y: 100 }

    expect(onStart).toHaveBeenCalledOnce()
  })

  test('onStart does not fire when another channel wakes mid-motion', ({ system }) => {
    const spring = system.createSpring({ x: 0, y: 0 }, config)

    const onStart = vi.fn()
    spring.onStart(onStart)

    spring.target = { x: 100 }
    system.advance(FRAME)
    spring.target = { y: 100 }

    expect(onStart).toHaveBeenCalledOnce()
  })

  test('stop arrives after the final update of the frame', ({ system }) => {
    const spring = system.createSpring({ x: 1, y: 1 }, config)
    spring.target = { x: 0, y: 0 }

    const order: string[] = []
    spring.onUpdate(() => order.push('update'))
    spring.onStop(() => order.push('stop'))

    for (let i = 0; i < 240 && !spring.isResting; i++) {
      system.advance(FRAME)
    }

    expect(spring.isResting).toBe(true)
    expect(order.filter((event) => event === 'stop')).toHaveLength(1)
    expect(order.at(-1)).toBe('stop')
    expect(order.at(-2)).toBe('update')
  })

  test('jumpTo emits a single update synchronously', ({ system }) => {
    const spring = system.createSpring({ position: { x: 0, y: 0 }, opacity: 1 }, config)

    const onUpdate = vi.fn()
    spring.onUpdate(onUpdate)

    spring.jumpTo({ position: { x: 50, y: 50 }, opacity: 0 })

    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(spring.value).toEqual({ position: { x: 50, y: 50 }, opacity: 0 })
    expect(spring.isResting).toBe(true)
  })

  test('unsubscribe stops composite events', ({ system }) => {
    const spring = system.createSpring({ x: 0, y: 0 }, config)
    spring.target = { x: 100, y: 100 }

    const onUpdate = vi.fn()
    const unsubscribe = spring.onUpdate(onUpdate)

    system.advance(FRAME)
    expect(onUpdate).toHaveBeenCalledTimes(1)

    unsubscribe()
    system.advance(FRAME)
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })
})

describe('CompositeSpring: partial jumps and writes', () => {
  test('jumpTo affects only the given channels', ({ system }) => {
    const spring = system.createSpring({ position: { x: 0, y: 0 }, opacity: 1 }, config)
    spring.target = { position: { x: 100, y: 100 } }

    spring.jumpTo({ opacity: 0 })

    expect(spring.value.opacity).toBe(0)
    expect(spring.isResting).toBe(false)
  })

  test('writing value displaces the given channels', ({ system }) => {
    const spring = system.createSpring({ x: 0, y: 0 }, config)

    spring.value = { x: 50 }

    expect(spring.value).toEqual({ x: 50, y: 0 })
    expect(spring.target).toEqual({ x: 0, y: 0 })
    expect(spring.isResting).toBe(false)
  })

  test('writing velocity injects energy into the given channels', ({ system }) => {
    const spring = system.createSpring({ x: 0, y: 0 }, config)

    spring.velocity = { x: 100 }
    system.advance(FRAME)

    expect(spring.value.x).not.toBe(0)
    expect(spring.value.y).toBe(0)
  })
})

describe('CompositeSpring: following', () => {
  test('follows another object channel-wise', ({ system }) => {
    const leader = system.createSpring({ position: { x: 0, y: 0 }, opacity: 0 }, config)
    const follower = system.createSpring({ position: { x: 0, y: 0 }, opacity: 0 })

    follower.target = leader
    leader.target = { position: { x: 100, y: 50 }, opacity: 1 }

    for (let i = 0; i < 600; i++) {
      system.advance(FRAME)
      if (follower.isResting) break
    }

    expect(follower.value.position.x).toBeCloseTo(100, 0)
    expect(follower.value.position.y).toBeCloseTo(50, 0)
    expect(follower.value.opacity).toBeCloseTo(1, 1)
  })

  test('chains: a follower of a follower propagates in the same frame', ({ system }) => {
    const a = system.createSpring({ x: 0 }, config)
    const b = system.createSpring({ x: 0 })
    const c = system.createSpring({ x: 0 })

    b.target = a
    c.target = b
    a.target = { x: 100 }

    system.advance(FRAME)

    expect(b.value.x).toBeGreaterThan(0)
    expect(c.isResting).toBe(false)
  })

  test('following a leader leaves channel configs untouched', ({ system }) => {
    const leader = system.createSpring({ x: 0, y: 0 }, config)
    const follower = system.createSpring({ x: 0, y: 0 })

    follower.target = leader

    expect(follower.config).toBe(SpringDefinition.default)
  })

  test('a partial numeric target detaches only the channels it names', ({ system }) => {
    const leader = system.createSpring({ x: 0, y: 0 }, config)
    const follower = system.createSpring({ x: 0, y: 0 })
    follower.target = leader

    follower.target = { x: -50 }
    leader.target = { x: 100, y: 100 }

    for (let i = 0; i < 600 && !follower.isResting; i++) {
      system.advance(FRAME)
    }

    expect(follower.value.x).toBeCloseTo(-50, 0)
    expect(follower.value.y).toBeCloseTo(100, 0)
  })

  test('throws on shape mismatches', ({ system }) => {
    const a = system.createSpring({ x: 0, y: 0 }, config)
    const b = system.createSpring({ x: 0 }, config)

    expect(() => {
      b.target = a as never
    }).toThrow('Shape mismatch')
    expect(() => {
      a.target = b as never
    }).toThrow('Shape mismatch')
  })

  test('a target shape can mix numbers and sources per channel', ({ system }) => {
    const leader = system.createSpring(0, config)
    const follower = system.createSpring({ x: 0, y: 0 }, config)

    follower.target = { x: 25, y: leader }
    leader.target = 100

    for (let i = 0; i < 600 && !follower.isResting; i++) system.advance(FRAME)

    expect(follower.value.x).toBeCloseTo(25, 0)
    expect(follower.value.y).toBeCloseTo(100, 0)
  })

  test('a channel can follow a value derived from another composite', ({ system }) => {
    const point = system.createSpring({ x: 3, y: 4 }, config)
    const follower = system.createSpring({ magnitude: 0, tag: 1 }, config)

    follower.target = { magnitude: mapSpring(point, ({ x, y }) => Math.hypot(x, y)) }

    for (let i = 0; i < 600 && !follower.isResting; i++) system.advance(FRAME)

    expect(follower.value.magnitude).toBeCloseTo(5, 0)
    expect(follower.value.tag).toBe(1)
  })

  test('a channel keeps its own config when following a source', ({ system }) => {
    const leader = system.createSpring(0, config)
    const follower = system.createSpring({ x: 0 })

    follower.target = { x: leader }

    expect(follower.config).toBe(SpringDefinition.default)
  })

  test('a source target detaches only the channels it names', ({ system }) => {
    const leader = system.createSpring({ x: 0, y: 0 }, config)
    const solo = system.createSpring(0, config)
    const follower = system.createSpring({ x: 0, y: 0 })
    follower.target = leader

    follower.target = { x: solo }
    leader.target = { x: 100, y: 100 }
    solo.target = -50

    for (let i = 0; i < 600; i++) {
      system.advance(FRAME)
      if (follower.isResting) break
    }

    expect(follower.value.x).toBeCloseTo(-50, 0)
    expect(follower.value.y).toBeCloseTo(100, 0)
  })

  test('any SpringSource can sit at a channel', ({ system }) => {
    const leader = makeSource(5)
    const follower = system.createSpring({ x: 0 }, config)

    follower.target = { x: leader.source }
    expect(follower.target.x).toBe(5)

    leader.set(80)
    advanceUntilResting(system, follower)

    expect(follower.value.x).toBeCloseTo(80, 0)
  })

  test('invalid channel targets throw with their path', ({ system }) => {
    const composite = system.createSpring({ x: 0, y: 0 })
    const follower = system.createSpring({ position: { x: 0, y: 0 } })

    expect(() => {
      follower.target = { position: { x: 'nope' } } as never
    }).toThrow("Invalid value at 'position.x': expected a finite number or a scalar SpringSource")

    expect(() => {
      follower.target = { position: { x: composite } } as never
    }).toThrow("Invalid value at 'position.x': expected a finite number or a scalar SpringSource")
  })
})

describe('CompositeSpring: settled promise', () => {
  test('resolves immediately when already resting', async ({ system }) => {
    const spring = system.createSpring({ x: 0 }, config)

    await expect(spring.settled).resolves.toBeUndefined()
  })

  test('resolves only when every channel has come to rest', async ({ system }) => {
    const spring = system.createSpring({ near: 0, far: 0 }, config)
    spring.target = { near: 1, far: 1000 }

    let resolved = false
    spring.settled.then(() => {
      resolved = true
    })

    for (let i = 0; i < 60; i++) system.advance(FRAME)
    await flush()
    expect(spring.value.near).toBe(1)
    expect(spring.isResting).toBe(false)
    expect(resolved).toBe(false)

    for (let i = 0; i < 1200 && !spring.isResting; i++) {
      system.advance(FRAME)
    }
    await flush()
    expect(resolved).toBe(true)
  })

  test('resolves when the composite leaves rest and returns within one tick', async ({
    system,
  }) => {
    const spring = system.createSpring({ x: 0 }, config)
    const driver = system.createSpring(0, config)
    driver.target = 1

    let settled: Promise<void> | undefined
    driver.onUpdate(() => {
      if (settled) return
      // The composite's start and stop wait for the end of the tick, so
      // the jump rests it before either fires.
      spring.target = { x: 10 }
      settled = spring.settled
      spring.jumpTo({ x: 10 })
    })
    system.advance(FRAME)

    let resolved = false
    void settled!.then(() => {
      resolved = true
    })
    await flush()
    expect(spring.isResting).toBe(true)
    expect(resolved).toBe(true)
  })

  test('dispose resolves a pending promise', async ({ system }) => {
    const spring = system.createSpring({ x: 0 }, config)
    spring.target = { x: 100 }

    const settled = spring.settled
    spring.dispose()

    await expect(settled).resolves.toBeUndefined()
  })
})

describe('CompositeSpring: reduced motion', () => {
  test('partial retargets jump instantly with a single update', () => {
    const system = createSpringSystem({ reducedMotion: 'always' })
    const spring = system.createSpring({ position: { x: 0, y: 0 }, opacity: 1 }, config)

    const onUpdate = vi.fn()
    const onStart = vi.fn()
    spring.onUpdate(onUpdate)
    spring.onStart(onStart)

    spring.target = { position: { x: 100, y: 50 } }

    expect(spring.value).toEqual({ position: { x: 100, y: 50 }, opacity: 1 })
    expect(spring.isResting).toBe(true)
    expect(onUpdate).toHaveBeenCalledOnce()
    expect(onStart).not.toHaveBeenCalled()
  })
})

describe('CompositeSpring: dispose', () => {
  test('dispose stops the spring and its events', ({ system }) => {
    const spring = system.createSpring({ x: 0, y: 0 }, config)
    spring.target = { x: 100, y: 100 }

    const onUpdate = vi.fn()
    spring.onUpdate(onUpdate)

    spring.dispose()
    system.advance(FRAME)

    expect(onUpdate).not.toHaveBeenCalled()
  })

  test('onDispose fires once for all channels', ({ system }) => {
    const spring = system.createSpring({ position: { x: 0, y: 0 }, opacity: 1 }, config)

    const onDispose = vi.fn()
    spring.onDispose(onDispose)

    spring.dispose()
    expect(onDispose).toHaveBeenCalledOnce()
  })

  test('writes to a disposed composite throw and change nothing', ({ system }) => {
    const spring = system.createSpring({ x: 0, y: 0 }, config)
    const other = system.createSpring(0, config)
    spring.target = { x: 100, y: 100 }
    other.target = 100
    system.advance(FRAME)
    spring.dispose()
    const value = { ...spring.value }
    const target = { ...spring.target }

    for (const write of [
      () => (spring.target = { x: 5 }),
      () => (spring.value = { x: 5 }),
      () => (spring.velocity = { x: 5 }),
      () => (spring.config = config),
      () => spring.jumpTo({ x: 5 }),
      () => (spring.target = system.createSpring({ x: 0, y: 0 })),
    ]) {
      expect(write).toThrow('Cannot write to a disposed spring')
    }
    expect(spring.value).toEqual(value)
    expect(spring.target).toEqual(target)

    const before = other.value
    expect(() => system.advance(FRAME)).not.toThrow()
    expect(other.value).toBeGreaterThan(before)
  })

  test('double dispose is a no-op', ({ system }) => {
    const spring = system.createSpring({ x: 0 }, config)

    const onDispose = vi.fn()
    spring.onDispose(onDispose)

    spring.dispose()
    expect(() => spring.dispose()).not.toThrow()
    expect(onDispose).toHaveBeenCalledOnce()
  })

  test('followers detach when the leader is disposed', ({ system }) => {
    const leader = system.createSpring({ x: 0 }, config)
    const follower = system.createSpring({ x: 0 })
    follower.target = leader

    leader.dispose()

    follower.target = { x: 100 }
    for (let i = 0; i < 600 && !follower.isResting; i++) {
      system.advance(FRAME)
    }

    expect(follower.value.x).toBeCloseTo(100, 0)
  })
})

describe('shape keys that strings alone cannot tell apart', () => {
  test('a dotted key and a nested path keep their own purposes', () => {
    const system = createSpringSystem({ reducedMotion: 'always' })
    const spring = system.createSpring({ 'a.b': 0, a: { b: 0 } }, undefined, {
      purpose: { 'a.b': 'nonmotion', a: { b: 'motion' } },
    })
    spring.target = { 'a.b': 10, a: { b: 10 } }
    // The 'motion' channel snaps under reduced motion. The other animates.
    expect(spring.value.a.b).toBe(10)
    expect(spring.value['a.b']).toBe(0)
  })

  test('a parsed __proto__ channel stays an own channel of every mirror', () => {
    const system = createSpringSystem({ reducedMotion: 'never' })
    const shape = JSON.parse('{"__proto__": 1, "x": { "__proto__": 2 }}') as Record<string, never>
    const spring = system.createSpring(shape)
    for (const view of [spring.value, spring.target, spring.velocity]) {
      expect(Object.keys(view)).toEqual(['__proto__', 'x'])
      expect(Object.getPrototypeOf(view)).toBe(Object.prototype)
    }
    expect(JSON.stringify(spring.value)).toBe('{"__proto__":1,"x":{"__proto__":2}}')

    spring.target = JSON.parse('{"__proto__": 5}')
    for (let i = 0; i < 600 && !spring.isResting; i++) system.advance(16)
    expect(Object.getOwnPropertyDescriptor(spring.value, '__proto__')?.value).toBe(5)
  })

  test('an array with holes is rejected with its path', () => {
    const system = createSpringSystem()
    // eslint-disable-next-line no-sparse-arrays
    expect(() => system.createSpring({ list: [1, , 3] } as never)).toThrow(
      "Invalid value at 'list.1': arrays must not have holes",
    )
  })
})
