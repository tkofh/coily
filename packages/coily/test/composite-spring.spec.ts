import { describe, expect, test, vi } from 'vitest'
import { SpringDefinition, defineSpring } from '../src/config.ts'
import { type SpringSource, SpringSourceSymbol, mapSpring } from '../src/spring-source.ts'
import { createSpringSystem } from '../src/system.ts'

const config = defineSpring({ mass: 1, tension: 170, damping: 26 })
const stiff = defineSpring({ tension: 1000, dampingRatio: 1 })
const gentle = defineSpring({ tension: 10, dampingRatio: 1 })

const FRAME = 1000 / 60

describe('CompositeSpring: creation', () => {
  test('creates resting at the given value', () => {
    const system = createSpringSystem()
    const spring = system.createSpring({ position: { x: 10, y: 20 }, opacity: 1 }, config)

    expect(spring.value).toEqual({ position: { x: 10, y: 20 }, opacity: 1 })
    expect(spring.target).toEqual({ position: { x: 10, y: 20 }, opacity: 1 })
    expect(spring.isResting).toBe(true)
  })

  test('supports arrays as shapes', () => {
    const system = createSpringSystem()
    const spring = system.createSpring({ color: [255, 128, 0] }, config)

    expect(spring.value).toEqual({ color: [255, 128, 0] })
    expect(Array.isArray(spring.value.color)).toBe(true)
  })

  test('supports numeric keys', () => {
    const system = createSpringSystem()
    const spring = system.createSpring({ 0: 5, 1: 10 }, config)

    expect(spring.value).toEqual({ 0: 5, 1: 10 })
  })

  test('value, velocity, and target return stable cached objects', () => {
    const system = createSpringSystem()
    const spring = system.createSpring({ position: { x: 0, y: 0 } }, config)

    expect(spring.value).toBe(spring.value)
    expect(spring.value.position).toBe(spring.value.position)
    expect(spring.velocity).toBe(spring.velocity)
    expect(spring.target).toBe(spring.target)
  })

  test('does not alias the input object', () => {
    const system = createSpringSystem()
    const input = { x: 1, y: 2 }
    const spring = system.createSpring(input, config)

    input.x = 99

    expect(spring.value.x).toBe(1)
  })

  test('throws on non-numeric leaves', () => {
    const system = createSpringSystem()

    expect(() =>
      system.createSpring({ position: { x: 0, y: 'nope' as unknown as number } }, config),
    ).toThrow("Invalid value at 'position.y'")
  })

  test('throws on non-finite leaves with their path', () => {
    const system = createSpringSystem()

    expect(() => system.createSpring({ position: { x: Number.NaN, y: 0 } })).toThrow(
      "Invalid value at 'position.x': channel values must be finite",
    )
  })

  test('throws on empty shapes and empty subtrees', () => {
    const system = createSpringSystem()

    // The `Shape` constraint also rejects these at compile time; the casts
    // keep the runtime backstop covered for untyped callers.
    expect(() => system.createSpring({} as never)).toThrow('at least one channel')
    expect(() => system.createSpring({ position: {} } as never)).toThrow('at least one channel')
    expect(() => system.createSpring({ items: [] } as never)).toThrow('at least one channel')
  })

  test('throws on non-plain objects in the shape', () => {
    const system = createSpringSystem()

    expect(() => system.createSpring({ when: new Date() as unknown as number })).toThrow(
      "Invalid value at 'when'",
    )
  })
})

describe('CompositeSpring: simulation', () => {
  test('animates every channel toward its target', () => {
    const system = createSpringSystem()
    const spring = system.createSpring({ position: { x: 0, y: 0 }, opacity: 0 }, config)

    spring.target = { position: { x: 100, y: 50 }, opacity: 1 }
    system.advance(100)

    expect(spring.value.position.x).toBeGreaterThan(0)
    expect(spring.value.position.x).toBeLessThan(100)
    expect(spring.value.position.y).toBeGreaterThan(0)
    expect(spring.value.opacity).toBeGreaterThan(0)
  })

  test('settles at the target', () => {
    const system = createSpringSystem()
    const spring = system.createSpring({ position: { x: 0, y: 0 }, opacity: 0 }, config)

    spring.target = { position: { x: 100, y: 50 }, opacity: 1 }
    for (let i = 0; i < 240 && !spring.isResting; i++) {
      system.advance(FRAME)
    }

    expect(spring.isResting).toBe(true)
    expect(spring.value).toEqual({ position: { x: 100, y: 50 }, opacity: 1 })
  })

  test('velocity reflects motion per channel', () => {
    const system = createSpringSystem()
    const spring = system.createSpring({ x: 0, y: 0 }, config)

    spring.target = { x: 100 }
    system.advance(FRAME)

    expect(spring.velocity.x).not.toBe(0)
    expect(spring.velocity.y).toBe(0)
  })

  test('timeRemaining is the max across channels', () => {
    const system = createSpringSystem()
    const spring = system.createSpring({ near: 0, far: 0 }, config)

    spring.target = { near: 1 }
    const nearOnly = spring.timeRemaining
    expect(nearOnly).toBeGreaterThan(0)

    spring.target = { far: 1000 }
    expect(spring.timeRemaining).toBeGreaterThan(nearOnly)
  })
})

describe('CompositeSpring: partial targets', () => {
  test('retargets only the given channels', () => {
    const system = createSpringSystem()
    const spring = system.createSpring({ position: { x: 0, y: 0 }, opacity: 1 }, config)

    spring.target = { opacity: 0 }

    expect(spring.target).toEqual({ position: { x: 0, y: 0 }, opacity: 0 })
    system.advance(100)
    expect(spring.value.position).toEqual({ x: 0, y: 0 })
    expect(spring.value.opacity).toBeLessThan(1)
  })

  test('partial arrays skip missing entries', () => {
    const system = createSpringSystem()
    const spring = system.createSpring({ color: [255, 128, 0] }, config)

    spring.target = { color: [0, undefined, 255] }

    expect(spring.target).toEqual({ color: [0, 128, 255] })
  })

  test('throws on unknown channels', () => {
    const system = createSpringSystem()
    const spring = system.createSpring({ position: { x: 0, y: 0 } }, config)

    expect(() => {
      spring.target = { position: { z: 5 } } as never
    }).toThrow("Unknown channel 'position.z'")
  })

  test('throws on out-of-range array indices', () => {
    const system = createSpringSystem()
    const spring = system.createSpring({ color: [0, 0, 0] }, config)

    expect(() => {
      spring.target = { color: [0, 0, 0, 0] } as never
    }).toThrow("Unknown channel 'color.3'")
  })

  test('throws on structure mismatches', () => {
    const system = createSpringSystem()
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

  test('throws on non-finite channel writes with their path', () => {
    const system = createSpringSystem()
    const spring = system.createSpring({ position: { x: 0, y: 0 } }, config)

    expect(() => {
      spring.target = { position: { x: Number.NaN } }
    }).toThrow("Invalid value at 'position.x': expected a finite number or a scalar SpringSource")
    expect(() => {
      spring.value = { position: { x: Number.POSITIVE_INFINITY } }
    }).toThrow("Expected a finite number for channel 'position.x'")
  })
})

describe('CompositeSpring: config shapes', () => {
  test('a single config applies to every channel', () => {
    const system = createSpringSystem()
    const spring = system.createSpring({ x: 0, y: 0 }, config)

    expect(spring.config).toBe(config)
  })

  test('rejects a bare options object as a single config', () => {
    const system = createSpringSystem()

    // Configs must be `SpringDefinition` instances (via `defineSpring`); a bare
    // options object reads as a config shape, so its option keys are unknown
    // channels.
    expect(() =>
      system.createSpring({ x: 0 }, { mass: 1, tension: 170, damping: 26 } as never),
    ).toThrow("Unknown channel 'mass'")
  })

  test('per-channel configs animate channels at different speeds', () => {
    const system = createSpringSystem()
    const spring = system.createSpring({ fast: 0, slow: 0 }, { fast: stiff, slow: gentle })

    spring.target = { fast: 100, slow: 100 }
    system.advance(100)

    expect(spring.value.fast).toBeGreaterThan(spring.value.slow)
    expect(spring.config).toBeNull()
  })

  test('a subtree config applies to every channel below it', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(
      { position: { x: 0, y: 0 }, opacity: 0 },
      { position: stiff },
    )

    spring.target = { position: { x: 100, y: 100 }, opacity: 100 }
    system.advance(100)

    expect(spring.value.position.x).toBe(spring.value.position.y)
    expect(spring.value.position.x).toBeGreaterThan(spring.value.opacity)
  })

  test('setting config to null reverts all channels to the default', () => {
    const system = createSpringSystem()
    const spring = system.createSpring({ x: 0, y: 0 }, config)

    spring.config = null

    expect(spring.config).toBe(SpringDefinition.default)
  })

  test('a partial config shape leaves unmentioned channels alone', () => {
    const system = createSpringSystem()
    const spring = system.createSpring({ x: 0, y: 0 }, config)

    spring.config = { x: stiff }

    expect(spring.config).toBeNull()
    spring.target = { x: 100, y: 100 }
    system.advance(100)
    expect(spring.value.x).not.toBe(spring.value.y)
  })

  test('rejects a numeric leaf in a config shape', () => {
    const system = createSpringSystem()

    // A plain object is a config shape, so its leaves must be configs — a
    // number is not, even when the channel is named like a spring option.
    expect(() =>
      system.createSpring({ tension: 0, damping: 0 }, { tension: 170, damping: 26 } as never),
    ).toThrow("Invalid config for 'tension'")
  })

  test('throws on config keys that are not channels', () => {
    const system = createSpringSystem()

    expect(() => system.createSpring({ x: 0 }, { opacityy: config } as never)).toThrow(
      "Unknown channel 'opacityy'",
    )
  })
})

describe('CompositeSpring: coalesced events', () => {
  test('onUpdate fires exactly once per frame while several channels move', () => {
    const system = createSpringSystem()
    const spring = system.createSpring({ position: { x: 0, y: 0 }, opacity: 0 }, config)
    spring.target = { position: { x: 100, y: 100 }, opacity: 1 }

    const onUpdate = vi.fn()
    spring.onUpdate(onUpdate)

    system.advance(FRAME)
    expect(onUpdate).toHaveBeenCalledTimes(1)

    system.advance(FRAME)
    expect(onUpdate).toHaveBeenCalledTimes(2)
  })

  test('onStart fires synchronously and once when several channels start together', () => {
    const system = createSpringSystem()
    const spring = system.createSpring({ x: 0, y: 0 }, config)

    const onStart = vi.fn()
    spring.onStart(onStart)

    spring.target = { x: 100, y: 100 }

    expect(onStart).toHaveBeenCalledOnce()
  })

  test('onStart does not fire when another channel wakes mid-motion', () => {
    const system = createSpringSystem()
    const spring = system.createSpring({ x: 0, y: 0 }, config)

    const onStart = vi.fn()
    spring.onStart(onStart)

    spring.target = { x: 100 }
    system.advance(FRAME)
    spring.target = { y: 100 }

    expect(onStart).toHaveBeenCalledOnce()
  })

  test('stop arrives after the final update of the frame', () => {
    const system = createSpringSystem()
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

  test('jumpTo emits a single update synchronously', () => {
    const system = createSpringSystem()
    const spring = system.createSpring({ position: { x: 0, y: 0 }, opacity: 1 }, config)

    const onUpdate = vi.fn()
    spring.onUpdate(onUpdate)

    spring.jumpTo({ position: { x: 50, y: 50 }, opacity: 0 })

    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(spring.value).toEqual({ position: { x: 50, y: 50 }, opacity: 0 })
    expect(spring.isResting).toBe(true)
  })

  test('unsubscribe stops composite events', () => {
    const system = createSpringSystem()
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
  test('jumpTo affects only the given channels', () => {
    const system = createSpringSystem()
    const spring = system.createSpring({ position: { x: 0, y: 0 }, opacity: 1 }, config)
    spring.target = { position: { x: 100, y: 100 } }

    spring.jumpTo({ opacity: 0 })

    expect(spring.value.opacity).toBe(0)
    expect(spring.isResting).toBe(false)
  })

  test('writing value displaces the given channels', () => {
    const system = createSpringSystem()
    const spring = system.createSpring({ x: 0, y: 0 }, config)

    spring.value = { x: 50 }

    expect(spring.value).toEqual({ x: 50, y: 0 })
    expect(spring.target).toEqual({ x: 0, y: 0 })
    expect(spring.isResting).toBe(false)
  })

  test('writing velocity injects energy into the given channels', () => {
    const system = createSpringSystem()
    const spring = system.createSpring({ x: 0, y: 0 }, config)

    spring.velocity = { x: 100 }
    system.advance(FRAME)

    expect(spring.value.x).not.toBe(0)
    expect(spring.value.y).toBe(0)
  })
})

describe('CompositeSpring: following', () => {
  test('follows another object channel-wise', () => {
    const system = createSpringSystem()
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

  test('chains: a follower of a follower propagates in the same frame', () => {
    const system = createSpringSystem()
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

  test('following a leader leaves channel configs untouched', () => {
    const system = createSpringSystem()
    const leader = system.createSpring({ x: 0, y: 0 }, config)
    const follower = system.createSpring({ x: 0, y: 0 })

    follower.target = leader

    expect(follower.config).toBe(SpringDefinition.default)
  })

  test('a partial numeric target detaches only the channels it names', () => {
    const system = createSpringSystem()
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

  test('throws on shape mismatches', () => {
    const system = createSpringSystem()
    const a = system.createSpring({ x: 0, y: 0 }, config)
    const b = system.createSpring({ x: 0 }, config)

    expect(() => {
      b.target = a as never
    }).toThrow('Shape mismatch')
    expect(() => {
      a.target = b as never
    }).toThrow('Shape mismatch')
  })

  test('a target shape can mix numbers and sources per channel', () => {
    const system = createSpringSystem()
    const leader = system.createSpring(0, config)
    const follower = system.createSpring({ x: 0, y: 0 }, config)

    follower.target = { x: 25, y: leader }
    leader.target = 100

    for (let i = 0; i < 600 && !follower.isResting; i++) system.advance(FRAME)

    expect(follower.value.x).toBeCloseTo(25, 0)
    expect(follower.value.y).toBeCloseTo(100, 0)
  })

  test('a channel can follow a value derived from another composite', () => {
    const system = createSpringSystem()
    const point = system.createSpring({ x: 3, y: 4 }, config)
    const follower = system.createSpring({ magnitude: 0, tag: 1 }, config)

    follower.target = { magnitude: mapSpring(point, ({ x, y }) => Math.hypot(x, y)) }

    for (let i = 0; i < 600 && !follower.isResting; i++) system.advance(FRAME)

    expect(follower.value.magnitude).toBeCloseTo(5, 0)
    expect(follower.value.tag).toBe(1)
  })

  test('a channel keeps its own config when following a source', () => {
    const system = createSpringSystem()
    const leader = system.createSpring(0, config)
    const follower = system.createSpring({ x: 0 })

    follower.target = { x: leader }

    expect(follower.config).toBe(SpringDefinition.default)
  })

  test('a source target detaches only the channels it names', () => {
    const system = createSpringSystem()
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

  test('any SpringSource can sit at a channel', () => {
    const system = createSpringSystem()
    const listeners = new Set<() => void>()
    let current = 5
    const source: SpringSource = {
      [SpringSourceSymbol]: true,
      get value() {
        return current
      },
      onUpdate: (callback) => {
        listeners.add(callback)
        return () => listeners.delete(callback)
      },
      onDispose: () => () => {},
    }
    const follower = system.createSpring({ x: 0 }, config)

    follower.target = { x: source }
    expect(follower.target.x).toBe(5)

    current = 80
    for (const callback of listeners) callback()
    for (let i = 0; i < 600 && !follower.isResting; i++) system.advance(FRAME)

    expect(follower.value.x).toBeCloseTo(80, 0)
  })

  test('invalid channel targets throw with their path', () => {
    const system = createSpringSystem()
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
  const flush = () => new Promise((resolve) => setTimeout(resolve))

  test('resolves immediately when already resting', async () => {
    const system = createSpringSystem()
    const spring = system.createSpring({ x: 0 }, config)

    await expect(spring.settled).resolves.toBeUndefined()
  })

  test('resolves only when every channel has come to rest', async () => {
    const system = createSpringSystem()
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

  test('dispose resolves a pending promise', async () => {
    const system = createSpringSystem()
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
  test('dispose stops the spring and its events', () => {
    const system = createSpringSystem()
    const spring = system.createSpring({ x: 0, y: 0 }, config)
    spring.target = { x: 100, y: 100 }

    const onUpdate = vi.fn()
    spring.onUpdate(onUpdate)

    spring.dispose()
    system.advance(FRAME)

    expect(onUpdate).not.toHaveBeenCalled()
  })

  test('onDispose fires once for all channels', () => {
    const system = createSpringSystem()
    const spring = system.createSpring({ position: { x: 0, y: 0 }, opacity: 1 }, config)

    const onDispose = vi.fn()
    spring.onDispose(onDispose)

    spring.dispose()
    expect(onDispose).toHaveBeenCalledOnce()
  })

  test('double dispose is a no-op', () => {
    const system = createSpringSystem()
    const spring = system.createSpring({ x: 0 }, config)

    const onDispose = vi.fn()
    spring.onDispose(onDispose)

    spring.dispose()
    expect(() => spring.dispose()).not.toThrow()
    expect(onDispose).toHaveBeenCalledOnce()
  })

  test('followers detach when the leader is disposed', () => {
    const system = createSpringSystem()
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
