import { describe, expect, vi } from 'vitest'
import { SpringDefinition, defineSpring } from '../src/config.ts'
import { type SpringSystemOptions, createSpringSystem } from '../src/system.ts'
import type { Spring } from '../src/spring.ts'
import { mapSpring } from '../src/spring-source.ts'
import { advanceUntilResting, makeSource, test } from './helpers.ts'

const config = defineSpring({ mass: 1, tension: 170, damping: 26 })

describe('Spring: following', () => {
  describe('creation', () => {
    test('starts at leader value', ({ system }) => {
      const leader = system.createSpring(50, config)
      const follower = system.createSpring(leader.value)
      follower.target = leader

      expect(follower.value).toBe(50)
    })

    test('starts at a mapped leader value', ({ system }) => {
      const leader = system.createSpring(50, config)
      const follower = system.createSpring(leader.value + 20)
      follower.target = mapSpring(leader, (value) => value + 20)

      expect(follower.value).toBe(70)
    })

    test('starts at custom value when provided', ({ system }) => {
      const leader = system.createSpring(50, config)
      const follower = system.createSpring(0)
      follower.target = leader

      expect(follower.value).toBe(0)
      expect(follower.isResting).toBe(false)
    })
  })

  describe('following', () => {
    test('follows leader to new target', ({ system }) => {
      const leader = system.createSpring(0, config)
      const follower = system.createSpring(leader.value)
      follower.target = leader

      leader.target = 100
      advanceUntilResting(system, follower)

      expect(follower.value).toBeCloseTo(100, 0)
    })

    test('follows a mapped leader', ({ system }) => {
      const leader = system.createSpring(0, config)
      const follower = system.createSpring(leader.value + 25)
      follower.target = mapSpring(leader, (value) => value + 25)

      leader.target = 100
      advanceUntilResting(system, follower)

      expect(follower.value).toBeCloseTo(125, 0)
    })

    test('follower lags behind leader', ({ system }) => {
      const leader = system.createSpring(0, config)
      const follower = system.createSpring(leader.value)
      follower.target = leader

      leader.target = 100
      for (let i = 0; i < 5; i++) system.advance(1000 / 60)

      const leaderDist = Math.abs(leader.value - 100)
      const followerDist = Math.abs(follower.value - 100)
      expect(leaderDist).toBeLessThan(followerDist)
    })

    test('chaining: follower of follower', ({ system }) => {
      const a = system.createSpring(0, config)
      const b = system.createSpring(a.value)
      b.target = a
      const c = system.createSpring(b.value)
      c.target = b

      a.target = 100
      advanceUntilResting(system, c)

      expect(c.value).toBeCloseTo(100, 0)
    })

    test('a follow wired after creation propagates in the same frame', ({ system }) => {
      // Regression: applying a config during follow used to park the resting
      // follower in the motion set, where it consumed its once-per-pass tick
      // before the leader emitted — adding a frame of lag per chain link.
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

    test('can switch from standalone to following', ({ system }) => {
      const leader = system.createSpring(100, config)
      const spring = system.createSpring(0, config)

      spring.target = leader
      advanceUntilResting(system, spring)

      expect(spring.value).toBeCloseTo(100, 0)
    })

    test('can switch from following to standalone', ({ system }) => {
      const leader = system.createSpring(100, config)
      const spring = system.createSpring(leader.value)
      spring.target = leader

      advanceUntilResting(system, spring)
      expect(spring.value).toBeCloseTo(100, 0)

      spring.target = 0
      advanceUntilResting(system, spring)

      expect(spring.value).toBeCloseTo(0, 0)
    })

    test('can switch to a different leader', ({ system }) => {
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

  describe('config independence', () => {
    test("a follower without a config uses the default, not the leader's", ({ system }) => {
      const leader = system.createSpring(0, config)
      const follower = system.createSpring(leader.value)
      follower.target = leader

      expect(follower.config).toBe(SpringDefinition.default)
    })

    test('uses its own config when provided', ({ system }) => {
      const leader = system.createSpring(0, config)
      const customConfig = defineSpring({ mass: 1, tension: 300, damping: 10 })
      const follower = system.createSpring(leader.value, customConfig)
      follower.target = leader

      expect(follower.tension).toBe(300)
    })

    test('leader reconfiguration does not touch followers', ({ system }) => {
      const leader = system.createSpring(0, config)
      const follower = system.createSpring(leader.value)
      follower.target = leader

      leader.config = defineSpring({ mass: 1, tension: 300, damping: 30 })

      expect(follower.config).toBe(SpringDefinition.default)
    })

    test('copying the leader config at creation is a snapshot, not a link', ({ system }) => {
      const leader = system.createSpring(0, config)
      const follower = system.createSpring(leader, leader.config)

      expect(follower.config).toBe(config)

      leader.config = defineSpring({ mass: 1, tension: 300, damping: 30 })
      expect(follower.config).toBe(config)
    })

    test('reconfiguring a follower mid-follow works in place', ({ system }) => {
      const leader = system.createSpring(0, config)
      const follower = system.createSpring(leader.value)
      follower.target = leader

      follower.config = defineSpring({ mass: 1, tension: 400, damping: 20 })

      expect(follower.tension).toBe(400)

      // Leader config change should not affect follower now
      leader.config = defineSpring({ mass: 1, tension: 999, damping: 99 })
      expect(follower.tension).toBe(400)
    })

    test('setting config to null reverts to the default while following', ({ system }) => {
      const leader = system.createSpring(0, config)
      const follower = system.createSpring(leader.value)
      follower.target = leader

      follower.config = defineSpring({ mass: 1, tension: 400, damping: 20 })
      expect(follower.tension).toBe(400)

      follower.config = null
      expect(follower.config).toBe(SpringDefinition.default)
    })
  })

  describe('events', () => {
    test('onUpdate fires when leader moves', ({ system }) => {
      const leader = system.createSpring(0, config)
      const follower = system.createSpring(leader.value)
      follower.target = leader
      const callback = vi.fn()

      follower.onUpdate(callback)
      leader.target = 100
      system.advance(1000 / 60)

      expect(callback).toHaveBeenCalled()
    })

    test('a follower emits exactly one update per frame', ({ system }) => {
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

    test('a follower woken mid-pass by its leader does not tick twice in one frame', ({
      system,
    }) => {
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
    test('follower stops following after dispose', ({ system }) => {
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

    test('leader dispose does not dispose followers', ({ system }) => {
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

    test('leader dispose detaches followers, which stay usable', ({ system }) => {
      const leader = system.createSpring(0, config)
      const follower = system.createSpring(leader.value)
      follower.target = leader

      leader.dispose()

      follower.target = 100

      for (let i = 0; i < 600; i++) {
        system.advance(1000 / 60)
        if (follower.isResting) break
      }

      expect(follower.value).toBeCloseTo(100, 0)
    })
  })

  describe('mapped and custom sources', () => {
    test('maps compose', ({ system }) => {
      const leader = system.createSpring(50, config)
      const follower = system.createSpring(0)
      follower.target = mapSpring(
        mapSpring(leader, (value) => -value),
        (value) => value + 10,
      )

      advanceUntilResting(system, follower)

      expect(follower.value).toBeCloseTo(-40, 0)
    })

    test('a map carries values, not configs', ({ system }) => {
      const leader = system.createSpring(0, config)
      const follower = system.createSpring(0)
      follower.target = mapSpring(leader, (value) => value * 2)

      expect(follower.config).toBe(SpringDefinition.default)

      leader.config = defineSpring({ mass: 1, tension: 300, damping: 30 })
      expect(follower.config).toBe(SpringDefinition.default)
    })

    test('leader dispose detaches followers through a map', ({ system }) => {
      const leader = system.createSpring(40, config)
      const follower = system.createSpring(0)
      follower.target = mapSpring(leader, (value) => value + 10)
      advanceUntilResting(system, follower)

      leader.dispose()
      follower.target = 100
      advanceUntilResting(system, follower)

      expect(follower.value).toBeCloseTo(100, 0)
    })

    test('any object honoring the SpringSource contract can be followed', ({ system }) => {
      const leader = makeSource(5)

      const follower = system.createSpring(0)
      follower.target = leader.source
      expect(follower.target).toBe(5)

      leader.set(80)
      advanceUntilResting(system, follower)

      expect(follower.value).toBeCloseTo(80, 0)
    })

    test('throws on a target that is neither a number nor a SpringSource', ({ system }) => {
      const spring = system.createSpring(0)

      expect(() => {
        spring.target = {} as never
      }).toThrow('Spring target must be a number or a SpringSource')
    })
  })

  describe('shape-mapped sources', () => {
    test('combines several leaders into one value', ({ system }) => {
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

    test('tracks whichever leader moves', ({ system }) => {
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

    test('nested shapes read as their values', ({ system }) => {
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

    test('arrays work as shapes', ({ system }) => {
      const a = system.createSpring(1, config)
      const b = system.createSpring(2, config)
      const follower = system.createSpring(0)
      follower.target = mapSpring([a, b] as const, ([first, second]) => first + second)

      expect(follower.target).toBe(3)
    })

    test('a shape map hands its map the same live mirror every call', ({ system }) => {
      const x = system.createSpring(1, config)
      const y = system.createSpring(2, config)

      const roots: unknown[] = []
      const points: unknown[] = []
      const follower = system.createSpring(
        mapSpring({ point: { x, y } }, (values) => {
          roots.push(values)
          points.push(values.point)
          return values.point.x + values.point.y
        }),
      )
      expect(follower.target).toBe(3)

      x.target = 10
      advanceUntilResting(system, follower)
      expect(follower.value).toBeCloseTo(12, 0)

      // The mirror refreshes in place: every call sees one object, at
      // every level, so per-update reads allocate nothing.
      expect(roots.length).toBeGreaterThan(2)
      for (const seen of roots) expect(seen).toBe(roots[0])
      for (const seen of points) expect(seen).toBe(points[0])
    })

    test('disposing any source detaches followers, which stay usable', ({ system }) => {
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

    test('a source at several leaves subscribes once', ({ system }) => {
      const leaf = makeSource(5)

      const follower = system.createSpring(0)
      follower.target = mapSpring({ a: leaf.source, b: leaf.source }, ({ a, b }) => a + b)

      expect(leaf.subscriptions).toBe(1)
      expect(follower.target).toBe(10)

      leaf.set(40)
      advanceUntilResting(system, follower)

      expect(follower.value).toBeCloseTo(80, 0)
    })

    test('a mapped source works as a leaf', ({ system }) => {
      const leader = system.createSpring(10, config)
      const doubled = mapSpring(leader, (value) => value * 2)
      const other = system.createSpring(1, config)
      const follower = system.createSpring(0)
      follower.target = mapSpring({ doubled, other }, ({ doubled, other }) => doubled + other)

      expect(follower.target).toBe(21)
    })

    test('throws on an invalid leaf with its path', ({ system }) => {
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
    test('a follower tracks a value derived from a composite spring', ({ system }) => {
      const lead = system.createSpring({ x: 3, y: 4 }, config)
      const follower = system.createSpring(mapSpring(lead, ({ x, y }) => Math.hypot(x, y)))

      expect(follower.value).toBe(5)

      lead.target = { x: 6, y: 8 }
      advanceUntilResting(system, follower)

      expect(follower.value).toBeCloseTo(10, 0)
    })

    test('composites work as leaves: the slope between two points', ({ system }) => {
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

    test('disposing the composite detaches followers through a map', ({ system }) => {
      const lead = system.createSpring({ x: 5, y: 5 }, config)
      const follower = system.createSpring(mapSpring(lead, ({ x, y }) => x + y))
      expect(follower.value).toBe(10)

      lead.dispose()
      follower.target = 42
      advanceUntilResting(system, follower)

      expect(follower.value).toBeCloseTo(42, 0)
    })

    test('a spring cannot follow a composite directly', ({ system }) => {
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
    test('starts at the source value and follows', ({ system }) => {
      const leader = system.createSpring(50, config)
      const follower = system.createSpring(leader)

      expect(follower.value).toBe(50)
      expect(follower.isResting).toBe(true)

      leader.target = 100
      advanceUntilResting(system, follower)

      expect(follower.value).toBeCloseTo(100, 0)
    })

    test('uses its own config, not the source config', ({ system }) => {
      const stiff = defineSpring({ mass: 1, tension: 300, damping: 30 })
      const leader = system.createSpring(0, config)
      const follower = system.createSpring(leader, stiff)
      const bare = system.createSpring(leader)

      expect(follower.config).toBe(stiff)
      expect(bare.config).toBe(SpringDefinition.default)
    })

    test('accepts a mapped source', ({ system }) => {
      const leader = system.createSpring(10, config)
      const follower = system.createSpring(mapSpring(leader, (value) => value * 2))

      expect(follower.value).toBe(20)

      leader.target = 50
      advanceUntilResting(system, follower)

      expect(follower.value).toBeCloseTo(100, 0)
    })

    test('rejects a composite spring', ({ system }) => {
      const lead = system.createSpring({ x: 0, y: 0 })

      expect(() => {
        system.createSpring(lead as never)
      }).toThrow('A spring can only follow a scalar SpringSource')
    })
  })

  describe('tick order', () => {
    test('a chain wired tail-first propagates in the same frame', ({ system }) => {
      const a = system.createSpring(0, config)
      const b = system.createSpring(0)
      const c = system.createSpring(0)
      // Wire the tail before the head: dependency order must come from
      // the graph, not from wiring order.
      c.target = b
      b.target = a

      a.target = 100
      system.advance(1000 / 60)

      expect(b.value).not.toBe(0)
      expect(c.isResting).toBe(false)
    })

    test('wiring order does not change trajectories', ({ system }) => {
      const a1 = system.createSpring(0, config)
      const b1 = system.createSpring(0)
      const c1 = system.createSpring(0)
      b1.target = a1
      c1.target = b1

      const a2 = system.createSpring(0, config)
      const b2 = system.createSpring(0)
      const c2 = system.createSpring(0)
      c2.target = b2
      b2.target = a2

      a1.target = 100
      a2.target = 100
      for (let i = 0; i < 60; i++) {
        system.advance(1000 / 60)
        expect(b2.value).toBe(b1.value)
        expect(c2.value).toBe(c1.value)
      }
    })

    test('rest and wake churn cannot invert the update order', ({ system }) => {
      const stiff = defineSpring({ mass: 1, tension: 800, damping: 80 })
      const soft = defineSpring({ mass: 1, tension: 2, damping: 4 })
      const a = system.createSpring(0, stiff)
      const b = system.createSpring(0, stiff)
      const c = system.createSpring(0, soft)
      b.target = a
      c.target = b

      const order: string[] = []
      a.onUpdate(() => order.push('a'))
      b.onUpdate(() => order.push('b'))
      c.onUpdate(() => order.push('c'))

      // Let the stiff links rest while the soft tail is still settling:
      // in an insertion-ordered set, the re-wakes below would land after
      // `c` and lag it by a frame from then on.
      a.target = 100
      system.advance(1000 / 60)
      expect(b.isResting).toBe(false)
      for (let i = 0; i < 600 && !b.isResting; i++) system.advance(1000 / 60)
      expect(b.isResting).toBe(true)
      expect(c.isResting).toBe(false)

      a.target = 200
      system.advance(1000 / 60)

      order.length = 0
      system.advance(1000 / 60)
      expect(order).toEqual(['a', 'b', 'c'])
    })

    test('update callbacks observe frame-final values across springs', ({ system }) => {
      const leader = system.createSpring(0, config)
      const follower = system.createSpring(0)
      follower.target = leader

      const seen: Array<{ at: string; leader: number; follower: number }> = []
      leader.onUpdate(() => {
        seen.push({ at: 'leader', leader: leader.value, follower: follower.value })
      })
      follower.onUpdate(() => {
        seen.push({ at: 'follower', leader: leader.value, follower: follower.value })
      })

      leader.target = 100
      system.advance(1000 / 60)

      // Events fire after every motion has advanced, leaders first: no
      // callback can catch another spring mid-frame.
      expect(seen.length).toBe(2)
      expect(seen[0]!.at).toBe('leader')
      for (const snap of seen) {
        expect(snap.leader).toBe(leader.value)
        expect(snap.follower).toBe(follower.value)
      }
    })

    test('a spring woken by an update callback advances from the next frame', ({ system }) => {
      const driver = system.createSpring(0, config)
      const bystander = system.createSpring(0, config)

      let woken = false
      driver.onUpdate(() => {
        if (!woken) {
          woken = true
          bystander.target = 100
        }
      })

      driver.target = 50
      system.advance(1000 / 60)

      // The callback ran at frame end, with no frame time left: the
      // write lands, the first advance comes next frame.
      expect(bystander.target).toBe(100)
      expect(bystander.value).toBe(0)
      expect(bystander.isResting).toBe(false)

      system.advance(1000 / 60)
      expect(bystander.value).not.toBe(0)
    })
  })

  describe('error-controlled sub-stepping', () => {
    // The coupling investigation's demo config: stiff and overdamped,
    // the regime where frame-grain coupling error is largest. A huge
    // tolerance pins K = 1, standing in for the pre-controller library.
    const stiff = defineSpring({ bounce: -1, duration: 265 })
    const K1 = { couplingTolerance: 1e9 }

    /** Releases a mutual pair from A=100/B=0 at 30fps and returns where it settles. */
    function releasePair(options?: SpringSystemOptions): [number, number] {
      const system = createSpringSystem(options)
      const a = system.createSpring(0, stiff)
      const b = system.createSpring(0, stiff)
      b.target = a
      a.target = b
      a.value = 100
      for (let i = 0; i < 90; i++) system.advance(33)
      return [a.value, b.value]
    }

    test('a mutual pair settles at its midpoint on coarse frames', () => {
      // Held-target coupling integrates whole frames against a stale
      // partner and bleeds the pair's conserved mean: at 33ms frames the
      // K = 1 baseline settles near 34 instead of the true 50
      // (follower-coupling-investigation.md section 4). Sub-stepping
      // converges it like 1/K.
      const [a, b] = releasePair()
      expect(Math.abs(a - b)).toBeLessThan(0.1)
      expect(Math.abs(a - 50)).toBeLessThan(3)

      const [baseline] = releasePair(K1)
      expect(Math.abs(baseline - 50)).toBeGreaterThan(10)
    })

    /** Flings a self-follower with v = 1000 and returns its total drift. */
    function fling(dtMs: number, options?: SpringSystemOptions): number {
      const system = createSpringSystem(options)
      const spring = system.createSpring(0, stiff)
      spring.target = spring
      spring.velocity = 1000
      for (let elapsed = 0; elapsed < 3000; elapsed += dtMs) system.advance(dtMs)
      return spring.value
    }

    test('a self-follow fling travels the same distance at 30 and 60 fps', () => {
      const gap = Math.abs(fling(33) / fling(1000 / 60) - 1)
      expect(gap).toBeLessThan(0.05)

      // The frame-rate dependence this fixes: K = 1 travels ~29% less
      // at 30fps than at 60fps.
      const baselineGap = Math.abs(fling(33, K1) / fling(1000 / 60, K1) - 1)
      expect(baselineGap).toBeGreaterThan(0.2)
    })

    /**
     * Advances a leader/follower pair through a 200-unit target teleport
     * at 33ms frames, each frame in `sub` equal advances, and returns the
     * follower's value at every whole-frame boundary.
     */
    function teleportTrail(
      sub: number,
      options?: SpringSystemOptions,
      wire: (leader: Spring, follower: Spring) => void = (leader, follower) => {
        follower.target = leader
      },
    ): number[] {
      const system = createSpringSystem(options)
      const leader = system.createSpring(0, stiff) as Spring
      const follower = system.createSpring(0, stiff) as Spring
      wire(leader, follower)
      leader.target = 200
      const trail: number[] = []
      for (let frame = 0; frame < 30; frame++) {
        for (let i = 0; i < sub; i++) system.advance(33 / sub)
        trail.push(follower.value)
      }
      return trail
    }

    function maxGap(a: number[], b: number[]): number {
      let gap = 0
      for (let i = 0; i < a.length; i++) gap = Math.max(gap, Math.abs(a[i]! - b[i]!))
      return gap
    }

    test('a teleport frame sub-steps toward the finely-stepped trajectory', () => {
      const reference = teleportTrail(16, K1)
      const controlled = maxGap(teleportTrail(1), reference)
      const baseline = maxGap(teleportTrail(1, K1), reference)

      expect(controlled).toBeLessThan(baseline / 3)
    })

    test('a teleport through a map escalates the same way', () => {
      // A derived source has no leader state in the mapped value's
      // units; the controller still catches the shock through the
      // underlying leader's own state.
      const viaMap = (leader: Spring, follower: Spring) => {
        follower.target = mapSpring(leader, (value) => value + 5)
      }
      const reference = teleportTrail(16, K1, viaMap)
      const controlled = maxGap(teleportTrail(1, undefined, viaMap), reference)
      const baseline = maxGap(teleportTrail(1, K1, viaMap), reference)

      expect(controlled).toBeLessThan(baseline / 3)
    })

    test('quiet frames stay single-step: bit-identical to a pinned K = 1 system', () => {
      const crawl = (options?: SpringSystemOptions): number[] => {
        const system = createSpringSystem(options)
        const leader = system.createSpring(0, stiff)
        const follower = system.createSpring(0, stiff)
        follower.target = leader
        const trail: number[] = []
        for (let frame = 0; frame < 60; frame++) {
          leader.target = frame * 0.05
          system.advance(1000 / 60)
          trail.push(leader.value, follower.value)
        }
        return trail
      }

      const controlled = crawl()
      const pinned = crawl(K1)
      for (let i = 0; i < controlled.length; i++) {
        expect(controlled[i]).toBe(pinned[i])
      }
    })

    test('a smoothly driven follower tracks its finely-stepped reference', () => {
      // First-order hold: the follower integrates against the leader's
      // actual within-frame move, so even 30fps frames stay within a
      // fraction of a unit of the finely-coupled trajectory.
      const chase = (sub: number): number[] => {
        const system = createSpringSystem()
        const leader = system.createSpring(0, stiff)
        const follower = system.createSpring(0, stiff)
        follower.target = leader
        const trail: number[] = []
        for (let frame = 0; frame < 60; frame++) {
          leader.target = 200 * Math.sin((2 * Math.PI * 0.75 * frame * 33) / 1000)
          for (let i = 0; i < sub; i++) system.advance(33 / sub)
          trail.push(follower.value)
        }
        return trail
      }

      // Measured 0.79; the same drive at frame-grain held-target
      // coupling sits in the tens.
      expect(maxGap(chase(1), chase(16))).toBeLessThan(1)
    })

    test('a mid-flight jumpTo stays a step at event time', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, stiff)
      const follower = system.createSpring(0, stiff)
      follower.target = leader
      leader.target = 200
      system.advance(33)

      const before = follower.value
      leader.jumpTo(50)

      // The retarget lands synchronously and exactly; the follower's
      // value moves only by animating — no ramp smears the jump across
      // the next frame.
      expect(follower.target).toBe(50)
      expect(follower.value).toBe(before)
    })

    test('an arrival follower never overshoots while following', () => {
      // arrival: 0 clamps at the target via closed-form crossings, which
      // only exist against a held target: the ramp fence must route this
      // follower to sub-stepped holds. An armed ramp would shift the
      // crossing equation and let the follower punch through.
      const system = createSpringSystem()
      const leader = system.createSpring(0, stiff)
      const follower = system.createSpring(
        0,
        defineSpring({ bounce: 0.4, duration: 500, arrival: 0 }),
      )
      follower.target = leader

      leader.target = 200
      for (let frame = 0; frame < 90; frame++) {
        system.advance(33)
        expect(follower.value).toBeLessThanOrEqual(follower.target + 1e-9)
      }
      expect(follower.value).toBeCloseTo(200, 0)
    })

    test('updates still fire once per spring per frame while sub-stepping', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, stiff)
      const follower = system.createSpring(0, stiff)
      follower.target = leader
      const composite = system.createSpring({ x: 0, y: 0 }, stiff)
      const compositeFollower = system.createSpring({ x: 0, y: 0 }, stiff)
      compositeFollower.target = composite

      const counts = { leader: 0, follower: 0, composite: 0 }
      leader.onUpdate(() => counts.leader++)
      follower.onUpdate(() => counts.follower++)
      compositeFollower.onUpdate(() => counts.composite++)

      // Teleports rail K for the frame; notification must not scale.
      leader.target = 200
      composite.target = { x: 200, y: 200 }
      system.advance(33)

      expect(counts).toEqual({ leader: 1, follower: 1, composite: 1 })
    })
  })
})
