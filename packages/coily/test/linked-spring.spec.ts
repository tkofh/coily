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

describe('LinkedSpring', () => {
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
      const follower = system.createSpring({ target: leader, offset: 20 })

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
      const follower = system.createSpring({ target: leader, offset: 25 })

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
  })

  describe('offset', () => {
    test('offset getter returns current offset', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const follower = system.createSpring({ target: leader, offset: 10 })

      expect(follower.offset).toBe(10)
    })

    test('offset setter updates target', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(50, config)
      const follower = system.createSpring({ target: leader, offset: 10 })

      follower.offset = 30
      advanceUntilResting(system, follower)

      expect(follower.value).toBeCloseTo(80, 0)
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
      leader.configure(newConfig)

      expect(follower.tension).toBe(300)
      expect(follower.damping).toBe(30)
    })

    test('does not inherit when config is overridden', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const customConfig = defineSpring({ mass: 1, tension: 300, damping: 10 })
      const follower = system.createSpring({ target: leader }, customConfig)

      const newConfig = defineSpring({ mass: 1, tension: 500, damping: 50 })
      leader.configure(newConfig)

      expect(follower.tension).toBe(300)
    })

    test('configure() on follower sets override', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const follower = system.createSpring({ target: leader })

      const overrideConfig = defineSpring({ mass: 1, tension: 400, damping: 20 })
      follower.configure(overrideConfig)

      expect(follower.tension).toBe(400)

      // Leader config change should not affect follower now
      leader.configure(defineSpring({ mass: 1, tension: 999, damping: 99 }))
      expect(follower.tension).toBe(400)
    })

    test('clearConfigOverride() resumes inheritance', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const follower = system.createSpring({ target: leader })

      follower.configure(defineSpring({ mass: 1, tension: 400, damping: 20 }))
      expect(follower.tension).toBe(400)

      follower.clearConfigOverride()
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

  describe('type safety', () => {
    test('linked spring does not have target setter', () => {
      const system = createSpringSystem()
      const leader = system.createSpring(0, config)
      const follower = system.createSpring({ target: leader })

      // LinkedSpring should not have a target setter in the type system.
      // At runtime, setting target on the prototype would be SpringBase's
      // read-only getter. This test verifies the property descriptor.
      const descriptor = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(follower),
        'target',
      )
      expect(descriptor?.set).toBeUndefined()
    })

    test('regular spring does not have offset', () => {
      const system = createSpringSystem()
      const spring = system.createSpring(0, config)

      expect('offset' in spring).toBe(false)
    })
  })
})
