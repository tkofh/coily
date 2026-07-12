import { describe, expect, test, vi } from 'vitest'
import { createSpringSystem } from '../src/system.ts'
import { SpringDefinition, defineSpring } from '../src/config.ts'
import { type SpringSource, SpringSourceSymbol, mapSpring } from '../src/spring-source.ts'

const config = defineSpring({ mass: 1, tension: 170, damping: 26 })

function advanceUntilResting(
  system: ReturnType<typeof createSpringSystem>,
  spring: { isResting: boolean },
  maxFrames = 600,
) {
  for (let i = 0; i < maxFrames; i++) {
    system.advance(1000 / 60)
    if (spring.isResting) return
  }
}

describe('Spring: following', () => {
  describe('creation', () => {
    test('starts at leader value', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(50, config)
      const follower = system.createSpring(leader.value)
      follower.target = leader

      expect(follower.value).toBe(50)
    })

    test('starts at a mapped leader value', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(50, config)
      const follower = system.createSpring(leader.value + 20)
      follower.target = mapSpring(leader, (value) => value + 20)

      expect(follower.value).toBe(70)
    })

    test('starts at custom value when provided', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(50, config)
      const follower = system.createSpring(0)
      follower.target = leader

      expect(follower.value).toBe(0)
      expect(follower.isResting).toBe(false)
    })
  })

  describe('following', () => {
    test('follows leader to new target', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const follower = system.createSpring(leader.value)
      follower.target = leader

      leader.target = 100
      advanceUntilResting(system, follower)

      expect(follower.value).toBeCloseTo(100, 0)
    })

    test('follows a mapped leader', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const follower = system.createSpring(leader.value + 25)
      follower.target = mapSpring(leader, (value) => value + 25)

      leader.target = 100
      advanceUntilResting(system, follower)

      expect(follower.value).toBeCloseTo(125, 0)
    })

    test('follower lags behind leader', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const follower = system.createSpring(leader.value)
      follower.target = leader

      leader.target = 100
      for (let i = 0; i < 5; i++) system.advance(1000 / 60)

      const leaderDist = Math.abs(leader.value - 100)
      const followerDist = Math.abs(follower.value - 100)
      expect(leaderDist).toBeLessThan(followerDist)
    })

    test('chaining: follower of follower', () => {
      const system = createSpringSystem()
      const a = system.createSpring(0, config)
      const b = system.createSpring(a.value)
      b.target = a
      const c = system.createSpring(b.value)
      c.target = b

      a.target = 100
      advanceUntilResting(system, c)

      expect(c.value).toBeCloseTo(100, 0)
    })

    test('a follow wired after creation propagates in the same frame', () => {
      // Regression: config inheritance on follow used to park the resting
      // follower in the motion set, where it consumed its once-per-pass tick
      // before the leader emitted — adding a frame of lag per chain link.
      const system = createSpringSystem()
      const a = system.createSpring(0, config)
      const b = system.createSpring(0)
      const c = system.createSpring(0)
      b.target = a
      c.target = b

      a.target = 100
      system.advance(1000 / 60)

      expect(b.value).not.toBe(0)
      expect(c.isResting).toBe(false)
    })

    test('can switch from standalone to following', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(100, config)
      const spring = system.createSpring(0, config)

      spring.target = leader
      advanceUntilResting(system, spring)

      expect(spring.value).toBeCloseTo(100, 0)
    })

    test('can switch from following to standalone', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(100, config)
      const spring = system.createSpring(leader.value)
      spring.target = leader

      advanceUntilResting(system, spring)
      expect(spring.value).toBeCloseTo(100, 0)

      spring.target = 0
      advanceUntilResting(system, spring)

      expect(spring.value).toBeCloseTo(0, 0)
    })

    test('can switch to a different leader', () => {
      const system = createSpringSystem()
      const a = system.createSpring(50, config)
      const b = system.createSpring(200, config)
      const follower = system.createSpring(a.value)
      follower.target = a

      advanceUntilResting(system, follower)
      expect(follower.value).toBeCloseTo(50, 0)

      follower.target = b
      advanceUntilResting(system, follower)

      expect(follower.value).toBeCloseTo(200, 0)
    })
  })

  describe('config inheritance', () => {
    test('inherits leader config by default', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const follower = system.createSpring(leader.value)
      follower.target = leader

      expect(follower.tension).toBe(leader.tension)
      expect(follower.damping).toBe(leader.damping)
    })

    test('uses custom config when provided', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const customConfig = defineSpring({ mass: 1, tension: 300, damping: 10 })
      const follower = system.createSpring(leader.value, customConfig)
      follower.target = leader

      expect(follower.tension).toBe(300)
    })

    test('picks up leader config changes when no override', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const follower = system.createSpring(leader.value)
      follower.target = leader

      const newConfig = defineSpring({ mass: 1, tension: 300, damping: 30 })
      leader.config = newConfig

      expect(follower.tension).toBe(300)
      expect(follower.damping).toBe(30)
    })

    test('does not inherit when config is overridden', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const customConfig = defineSpring({ mass: 1, tension: 300, damping: 10 })
      const follower = system.createSpring(leader.value, customConfig)
      follower.target = leader

      const newConfig = defineSpring({ mass: 1, tension: 500, damping: 50 })
      leader.config = newConfig

      expect(follower.tension).toBe(300)
    })

    test('setting config on follower overrides inheritance', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const follower = system.createSpring(leader.value)
      follower.target = leader

      follower.config = defineSpring({ mass: 1, tension: 400, damping: 20 })

      expect(follower.tension).toBe(400)

      // Leader config change should not affect follower now
      leader.config = defineSpring({ mass: 1, tension: 999, damping: 99 })
      expect(follower.tension).toBe(400)
    })

    test('setting config to null resumes inheritance', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const follower = system.createSpring(leader.value)
      follower.target = leader

      follower.config = defineSpring({ mass: 1, tension: 400, damping: 20 })
      expect(follower.tension).toBe(400)

      follower.config = null
      expect(follower.tension).toBe(leader.tension)
    })

    test('config changes propagate through a chain of inheriting followers', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const middle = system.createSpring(leader.value)
      middle.target = leader
      const tail = system.createSpring(middle.value)
      tail.target = middle

      leader.config = defineSpring({ mass: 1, tension: 300, damping: 30 })

      expect(middle.tension).toBe(300)
      expect(tail.tension).toBe(300)
    })

    test('an overriding follower stops propagation to itself but keeps its own followers', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const middle = system.createSpring(
        leader.value,
        defineSpring({ mass: 1, tension: 400, damping: 20 }),
      )
      middle.target = leader
      const tail = system.createSpring(middle.value)
      tail.target = middle

      leader.config = defineSpring({ mass: 1, tension: 300, damping: 30 })

      expect(middle.tension).toBe(400)
      expect(tail.tension).toBe(400)
    })

    test('unfollowing keeps the inherited config but stops tracking the ex-leader', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const follower = system.createSpring(leader.value)
      follower.target = leader

      follower.target = 50
      expect(follower.tension).toBe(config.tension)

      leader.config = defineSpring({ mass: 1, tension: 999, damping: 99 })
      expect(follower.tension).toBe(config.tension)
    })
  })

  describe('events', () => {
    test('onUpdate fires when leader moves', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const follower = system.createSpring(leader.value)
      follower.target = leader
      const callback = vi.fn()

      follower.onUpdate(callback)
      leader.target = 100
      system.advance(1000 / 60)

      expect(callback).toHaveBeenCalled()
    })

    test('a follower emits exactly one update per frame', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const follower = system.createSpring(leader.value)
      follower.target = leader
      const callback = vi.fn()

      follower.onUpdate(callback)
      leader.target = 100

      system.advance(1000 / 60)
      expect(callback).toHaveBeenCalledOnce()

      system.advance(1000 / 60)
      expect(callback).toHaveBeenCalledTimes(2)
    })

    test('a follower woken mid-pass by its leader does not tick twice in one frame', () => {
      const system = createSpringSystem()
      // Construct a follower whose motion sits BEFORE its leader's in the
      // motion set: it rests and is removed during the pass, then the leader's
      // update re-adds it — it must not advance (or emit) twice that frame.
      const follower = system.createSpring(0, config)
      const leader = system.createSpring(0, config)

      // Wake the follower with a sub-threshold displacement so it occupies a
      // set slot ahead of the leader while rounding to "resting".
      follower.value = 0.004
      follower.target = leader
      leader.target = 100

      const callback = vi.fn()
      follower.onUpdate(callback)

      system.advance(1000 / 60)
      expect(callback).toHaveBeenCalledOnce()
    })
  })

  describe('dispose', () => {
    test('follower stops following after dispose', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const follower = system.createSpring(leader.value)
      follower.target = leader
      const callback = vi.fn()

      follower.onUpdate(callback)
      leader.target = 50
      system.advance(1000 / 60)
      const callCount = callback.mock.calls.length

      follower.dispose()
      leader.target = 200
      system.advance(1000 / 60)

      expect(callback.mock.calls.length).toBe(callCount)
    })

    test('leader dispose does not dispose followers', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const follower = system.createSpring(leader.value)
      follower.target = leader

      leader.target = 50
      system.advance(1000 / 60)
      const posBeforeDispose = follower.value

      leader.dispose()

      // Follower keeps its position
      expect(follower.value).toBe(posBeforeDispose)
    })

    test('leader dispose detaches followers, which stay usable', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const follower = system.createSpring(leader.value)
      follower.target = leader

      leader.dispose()

      // Follower keeps the inherited config and can be retargeted normally
      expect(follower.tension).toBe(config.tension)
      follower.target = 100

      for (let i = 0; i < 600; i++) {
        system.advance(1000 / 60)
        if (follower.isResting) break
      }

      expect(follower.value).toBeCloseTo(100, 0)
    })
  })

  describe('mapped and custom sources', () => {
    test('maps compose', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(50, config)
      const follower = system.createSpring(0)
      follower.target = mapSpring(
        mapSpring(leader, (value) => -value),
        (value) => value + 10,
      )

      advanceUntilResting(system, follower)

      expect(follower.value).toBeCloseTo(-40, 0)
    })

    test('inherits the leader config through a map', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const follower = system.createSpring(0)
      follower.target = mapSpring(leader, (value) => value * 2)

      expect(follower.tension).toBe(config.tension)
    })

    test('leader config changes cascade through a map', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const follower = system.createSpring(0)
      follower.target = mapSpring(leader, (value) => value * 2)

      leader.config = defineSpring({ mass: 1, tension: 300, damping: 30 })

      expect(follower.tension).toBe(300)
    })

    test('leader dispose detaches followers through a map', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(40, config)
      const follower = system.createSpring(0)
      follower.target = mapSpring(leader, (value) => value + 10)
      advanceUntilResting(system, follower)

      leader.dispose()
      follower.target = 100
      advanceUntilResting(system, follower)

      expect(follower.value).toBeCloseTo(100, 0)
    })

    test('any object honoring the SpringSource contract can be followed', () => {
      const system = createSpringSystem()
      const listeners = new Set<() => void>()
      let current = 5
      const source: SpringSource = {
        [SpringSourceSymbol]: true,
        get value() {
          return current
        },
        config: null,
        onUpdate: (callback) => {
          listeners.add(callback)
          return () => listeners.delete(callback)
        },
        onConfigure: () => () => {},
        onDispose: () => () => {},
      }

      const follower = system.createSpring(0)
      follower.target = source
      expect(follower.target).toBe(5)

      current = 80
      for (const callback of listeners) callback()
      advanceUntilResting(system, follower)

      expect(follower.value).toBeCloseTo(80, 0)
    })

    test('throws on a target that is neither a number nor a SpringSource', () => {
      const system = createSpringSystem()
      const spring = system.createSpring(0)

      expect(() => {
        spring.target = {} as never
      }).toThrow('Spring target must be a number or a SpringSource')
    })
  })

  describe('shape-mapped sources', () => {
    test('combines several leaders into one value', () => {
      const system = createSpringSystem()
      const x = system.createSpring(3, config)
      const y = system.createSpring(4, config)
      const follower = system.createSpring(0)
      follower.target = mapSpring({ x, y }, ({ x, y }) => Math.hypot(x, y))

      expect(follower.target).toBe(5)

      x.target = 6
      y.target = 8
      advanceUntilResting(system, follower)

      expect(follower.value).toBeCloseTo(10, 0)
    })

    test('tracks whichever leader moves', () => {
      const system = createSpringSystem()
      const a = system.createSpring(0, config)
      const b = system.createSpring(0, config)
      const follower = system.createSpring(0)
      follower.target = mapSpring({ a, b }, ({ a, b }) => a + b)

      a.target = 100
      advanceUntilResting(system, follower)
      expect(follower.value).toBeCloseTo(100, 0)

      b.target = 50
      advanceUntilResting(system, follower)
      expect(follower.value).toBeCloseTo(150, 0)
    })

    test('nested shapes read as their values', () => {
      const system = createSpringSystem()
      const x = system.createSpring(1, config)
      const y = system.createSpring(2, config)
      const scale = system.createSpring(10, config)
      const follower = system.createSpring(0)
      follower.target = mapSpring(
        { point: { x, y }, scale },
        ({ point, scale }) => (point.x + point.y) * scale,
      )

      expect(follower.target).toBe(30)
    })

    test('arrays work as shapes', () => {
      const system = createSpringSystem()
      const a = system.createSpring(1, config)
      const b = system.createSpring(2, config)
      const follower = system.createSpring(0)
      follower.target = mapSpring([a, b] as const, ([first, second]) => first + second)

      expect(follower.target).toBe(3)
    })

    test('offers no config when given null', () => {
      const system = createSpringSystem()
      const a = system.createSpring(0, config)
      const b = system.createSpring(0, config)
      const follower = system.createSpring(0)
      follower.target = mapSpring({ a, b }, ({ a, b }) => a + b, null)

      expect(follower.config).toBe(SpringDefinition.default)
    })

    test('offers the given config to followers', () => {
      const system = createSpringSystem()
      const a = system.createSpring(0)
      const b = system.createSpring(0)
      const follower = system.createSpring(0)
      follower.target = mapSpring({ a, b }, ({ a, b }) => a + b, config)

      expect(follower.config).toBe(config)
    })

    test('omitted config passes through the config the sources share', () => {
      const system = createSpringSystem()
      const a = system.createSpring(0, config)
      const b = system.createSpring(0, config)
      const follower = system.createSpring(0)
      follower.target = mapSpring({ a, b }, ({ a, b }) => a + b)

      expect(follower.config).toBe(config)
    })

    test('omitted config offers none while the sources disagree', () => {
      const stiff = defineSpring({ mass: 1, tension: 300, damping: 30 })
      const system = createSpringSystem()
      const a = system.createSpring(0, config)
      const b = system.createSpring(0, stiff)
      const follower = system.createSpring(0)
      follower.target = mapSpring({ a, b }, ({ a, b }) => a + b)

      expect(follower.config).toBe(SpringDefinition.default)
    })

    test('the shared config tracks source reconfiguration', () => {
      const stiff = defineSpring({ mass: 1, tension: 300, damping: 30 })
      const system = createSpringSystem()
      const a = system.createSpring(0, config)
      const b = system.createSpring(0, config)
      const follower = system.createSpring(0)
      follower.target = mapSpring({ a, b }, ({ a, b }) => a + b)
      expect(follower.config).toBe(config)

      b.config = stiff
      expect(follower.config).toBe(SpringDefinition.default)

      a.config = stiff
      expect(follower.config).toBe(stiff)
    })

    test('a pinned map participates as a leaf with the config it offers', () => {
      const stiff = defineSpring({ mass: 1, tension: 300, damping: 30 })
      const system = createSpringSystem()
      const x = system.createSpring(0, config)
      const inverted = mapSpring(x, (value) => -value, stiff)
      const y = system.createSpring(0, stiff)
      const follower = system.createSpring(0)
      follower.target = mapSpring({ inverted, y }, ({ inverted, y }) => inverted + y)

      expect(follower.config).toBe(stiff)
    })

    test("a single-source map offers its given config instead of the leader's", () => {
      const stiff = defineSpring({ mass: 1, tension: 300, damping: 30 })
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const follower = system.createSpring(0)
      follower.target = mapSpring(leader, (value) => value, stiff)

      expect(follower.tension).toBe(300)

      leader.config = defineSpring({ mass: 1, tension: 500, damping: 40 })
      expect(follower.tension).toBe(300)
    })

    test('disposing any source detaches followers, which stay usable', () => {
      const system = createSpringSystem()
      const a = system.createSpring(10, config)
      const b = system.createSpring(20, config)
      const follower = system.createSpring(30)
      follower.target = mapSpring({ a, b }, ({ a, b }) => a + b)

      b.dispose()
      a.target = 100
      advanceUntilResting(system, a)
      expect(follower.target).toBeCloseTo(30, 0)

      follower.target = 50
      advanceUntilResting(system, follower)
      expect(follower.value).toBeCloseTo(50, 0)
    })

    test('a source at several leaves subscribes once', () => {
      const system = createSpringSystem()
      const listeners = new Set<() => void>()
      let subscriptions = 0
      let current = 5
      const source: SpringSource = {
        [SpringSourceSymbol]: true,
        get value() {
          return current
        },
        config: null,
        onUpdate: (callback) => {
          subscriptions++
          listeners.add(callback)
          return () => listeners.delete(callback)
        },
        onConfigure: () => () => {},
        onDispose: () => () => {},
      }

      const follower = system.createSpring(0)
      follower.target = mapSpring({ a: source, b: source }, ({ a, b }) => a + b)

      expect(subscriptions).toBe(1)
      expect(follower.target).toBe(10)

      current = 40
      for (const callback of listeners) callback()
      advanceUntilResting(system, follower)

      expect(follower.value).toBeCloseTo(80, 0)
    })

    test('a mapped source works as a leaf', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(10, config)
      const doubled = mapSpring(leader, (value) => value * 2)
      const other = system.createSpring(1, config)
      const follower = system.createSpring(0)
      follower.target = mapSpring({ doubled, other }, ({ doubled, other }) => doubled + other)

      expect(follower.target).toBe(21)
    })

    test('throws on an invalid leaf with its path', () => {
      const system = createSpringSystem()
      const spring = system.createSpring(0)

      expect(() => {
        mapSpring({ position: { x: spring, z: 5 } } as never, () => 0)
      }).toThrow(
        "Invalid value at 'position.z': expected a SpringSource or a nested shape of SpringSources",
      )
    })

    test('throws on an empty shape', () => {
      expect(() => {
        mapSpring({} as never, () => 0)
      }).toThrow('Invalid value at the root: a shape must contain at least one source')
    })
  })

  describe('composite sources', () => {
    test('a follower tracks a value derived from a composite spring', () => {
      const system = createSpringSystem()
      const lead = system.createSpring({ x: 3, y: 4 }, config)
      const follower = system.createSpring(mapSpring(lead, ({ x, y }) => Math.hypot(x, y)))

      expect(follower.value).toBe(5)

      lead.target = { x: 6, y: 8 }
      advanceUntilResting(system, follower)

      expect(follower.value).toBeCloseTo(10, 0)
    })

    test('composites work as leaves: the slope between two points', () => {
      const system = createSpringSystem()
      const p1 = system.createSpring({ x: 0, y: 0 }, config)
      const p2 = system.createSpring({ x: 10, y: 10 }, config)
      const slope = system.createSpring(
        mapSpring([p1, p2], ([from, to]) => (to.y - from.y) / (to.x - from.x)),
      )

      expect(slope.value).toBe(1)

      p2.target = { y: 30 }
      advanceUntilResting(system, slope)

      expect(slope.value).toBeCloseTo(3, 0)
    })

    test('a composite map offers its given config', () => {
      const system = createSpringSystem()
      const lead = system.createSpring({ x: 0, y: 0 })
      const follower = system.createSpring(mapSpring(lead, ({ x, y }) => x + y, config))

      expect(follower.config).toBe(config)
    })

    test("omitted config passes the channels' shared config through", () => {
      const system = createSpringSystem()
      const lead = system.createSpring({ x: 0, y: 0 }, config)
      const follower = system.createSpring(mapSpring(lead, ({ x, y }) => x + y))

      expect(follower.config).toBe(config)

      lead.config = { x: defineSpring({ mass: 1, tension: 300, damping: 30 }) }
      expect(follower.config).toBe(SpringDefinition.default)
    })

    test('disposing the composite detaches followers through a map', () => {
      const system = createSpringSystem()
      const lead = system.createSpring({ x: 5, y: 5 }, config)
      const follower = system.createSpring(mapSpring(lead, ({ x, y }) => x + y))
      expect(follower.value).toBe(10)

      lead.dispose()
      follower.target = 42
      advanceUntilResting(system, follower)

      expect(follower.value).toBeCloseTo(42, 0)
    })

    test('a spring cannot follow a composite directly', () => {
      const system = createSpringSystem()
      const lead = system.createSpring({ x: 0, y: 0 })
      const spring = system.createSpring(0)

      expect(() => {
        spring.target = lead as never
      }).toThrow(
        'A spring can only follow a scalar SpringSource; derive one from a composite with mapSpring',
      )
    })
  })

  describe('creation from a source', () => {
    test('starts at the source value and follows', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(50, config)
      const follower = system.createSpring(leader)

      expect(follower.value).toBe(50)
      expect(follower.isResting).toBe(true)

      leader.target = 100
      advanceUntilResting(system, follower)

      expect(follower.value).toBeCloseTo(100, 0)
    })

    test('adopts the source config without one of its own', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const follower = system.createSpring(leader)

      expect(follower.config).toBe(config)
    })

    test('keeps its own config when given one', () => {
      const stiff = defineSpring({ mass: 1, tension: 300, damping: 30 })
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const follower = system.createSpring(leader, stiff)

      expect(follower.config).toBe(stiff)
    })

    test('accepts a mapped source', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(10, config)
      const follower = system.createSpring(mapSpring(leader, (value) => value * 2))

      expect(follower.value).toBe(20)

      leader.target = 50
      advanceUntilResting(system, follower)

      expect(follower.value).toBeCloseTo(100, 0)
    })

    test('rejects a composite spring', () => {
      const system = createSpringSystem()
      const lead = system.createSpring({ x: 0, y: 0 })

      expect(() => {
        system.createSpring(lead as never)
      }).toThrow('A spring can only follow a scalar SpringSource')
    })
  })
})
