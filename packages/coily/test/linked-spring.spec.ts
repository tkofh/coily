import { describe, expect, test, vi } from 'vitest'
import { createSpringSystem } from '../src/system.ts'
import { defineSpring } from '../src/config.ts'

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

    test('starts at leader value plus offset', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(50, config)
      const follower = system.createSpring(leader.value + 20)
      follower.target = { spring: leader, offset: 20 }

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

    test('follows leader with offset', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const follower = system.createSpring(leader.value + 25)
      follower.target = { spring: leader, offset: 25 }

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
})
