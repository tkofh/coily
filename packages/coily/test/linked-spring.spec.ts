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
      const follower = system.createSpring({ target: leader })

      expect(follower.value).toBe(50)
    })

    test('starts at leader value plus offset', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(50, config)
      const follower = system.createSpring({ target: { spring: leader, offset: 20 } })

      expect(follower.value).toBe(70)
    })

    test('starts at custom value when provided', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(50, config)
      const follower = system.createSpring({ target: leader, value: 0 })

      expect(follower.value).toBe(0)
      expect(follower.isResting).toBe(false)
    })
  })

  describe('following', () => {
    test('follows leader to new target', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const follower = system.createSpring({ target: leader })

      leader.target = 100
      advanceUntilResting(system, follower)

      expect(follower.value).toBeCloseTo(100, 0)
    })

    test('follows leader with offset', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const follower = system.createSpring({ target: { spring: leader, offset: 25 } })

      leader.target = 100
      advanceUntilResting(system, follower)

      expect(follower.value).toBeCloseTo(125, 0)
    })

    test('follower lags behind leader', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const follower = system.createSpring({ target: leader })

      leader.target = 100
      for (let i = 0; i < 5; i++) system.advance(1000 / 60)

      const leaderDist = Math.abs(leader.value - 100)
      const followerDist = Math.abs(follower.value - 100)
      expect(leaderDist).toBeLessThan(followerDist)
    })

    test('chaining: follower of follower', () => {
      const system = createSpringSystem()
      const a = system.createSpring(0, config)
      const b = system.createSpring({ target: a })
      const c = system.createSpring({ target: b })

      a.target = 100
      advanceUntilResting(system, c)

      expect(c.value).toBeCloseTo(100, 0)
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
      const spring = system.createSpring({ target: leader })

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
      const follower = system.createSpring({ target: a })

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
      const follower = system.createSpring({ target: leader })

      expect(follower.tension).toBe(leader.tension)
      expect(follower.damping).toBe(leader.damping)
    })

    test('uses custom config when provided', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const customConfig = defineSpring({ mass: 1, tension: 300, damping: 10 })
      const follower = system.createSpring({ target: leader }, customConfig)

      expect(follower.tension).toBe(300)
    })

    test('picks up leader config changes when no override', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const follower = system.createSpring({ target: leader })

      const newConfig = defineSpring({ mass: 1, tension: 300, damping: 30 })
      leader.config = newConfig

      expect(follower.tension).toBe(300)
      expect(follower.damping).toBe(30)
    })

    test('does not inherit when config is overridden', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const customConfig = defineSpring({ mass: 1, tension: 300, damping: 10 })
      const follower = system.createSpring({ target: leader }, customConfig)

      const newConfig = defineSpring({ mass: 1, tension: 500, damping: 50 })
      leader.config = newConfig

      expect(follower.tension).toBe(300)
    })

    test('setting config on follower overrides inheritance', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const follower = system.createSpring({ target: leader })

      follower.config = defineSpring({ mass: 1, tension: 400, damping: 20 })

      expect(follower.tension).toBe(400)

      // Leader config change should not affect follower now
      leader.config = defineSpring({ mass: 1, tension: 999, damping: 99 })
      expect(follower.tension).toBe(400)
    })

    test('setting config to null resumes inheritance', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const follower = system.createSpring({ target: leader })

      follower.config = defineSpring({ mass: 1, tension: 400, damping: 20 })
      expect(follower.tension).toBe(400)

      follower.config = null
      expect(follower.tension).toBe(leader.tension)
    })
  })

  describe('events', () => {
    test('onUpdate fires when leader moves', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const follower = system.createSpring({ target: leader })
      const callback = vi.fn()

      follower.onUpdate(callback)
      leader.target = 100
      system.advance(1000 / 60)

      expect(callback).toHaveBeenCalled()
    })
  })

  describe('dispose', () => {
    test('follower stops following after dispose', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const follower = system.createSpring({ target: leader })
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
      const follower = system.createSpring({ target: leader })

      leader.target = 50
      system.advance(1000 / 60)
      const posBeforeDispose = follower.value

      leader.dispose()

      // Follower keeps its position
      expect(follower.value).toBe(posBeforeDispose)
    })
  })
})
