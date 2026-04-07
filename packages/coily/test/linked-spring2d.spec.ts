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

describe('Spring2D: following', () => {
  describe('creation', () => {
    test('starts at leader value', () => {
      const system = createSpringSystem()
      const leader = system.createSpring2D({ x: 50, y: 75 }, config)
      const follower = system.createSpring2D({ target: leader })

      expect(follower.value).toEqual({ x: 50, y: 75 })
    })

    test('starts at leader value plus offset', () => {
      const system = createSpringSystem()
      const leader = system.createSpring2D({ x: 50, y: 75 }, config)
      const follower = system.createSpring2D({
        target: { spring: leader, offset: { x: 10, y: 20 } },
      })

      expect(follower.value).toEqual({ x: 60, y: 95 })
    })

    test('starts at custom value when provided', () => {
      const system = createSpringSystem()
      const leader = system.createSpring2D({ x: 50, y: 75 }, config)
      const follower = system.createSpring2D({
        target: leader,
        value: { x: 0, y: 0 },
      })

      expect(follower.value).toEqual({ x: 0, y: 0 })
      expect(follower.isResting).toBe(false)
    })
  })

  describe('following', () => {
    test('follows leader to new target', () => {
      const system = createSpringSystem()
      const leader = system.createSpring2D({ x: 0, y: 0 }, config)
      const follower = system.createSpring2D({ target: leader })

      leader.target = { x: 100, y: 200 }
      advanceUntilResting(system, follower)

      expect(follower.value.x).toBeCloseTo(100, 0)
      expect(follower.value.y).toBeCloseTo(200, 0)
    })

    test('follows leader with offset', () => {
      const system = createSpringSystem()
      const leader = system.createSpring2D({ x: 0, y: 0 }, config)
      const follower = system.createSpring2D({
        target: { spring: leader, offset: { x: 25, y: -10 } },
      })

      leader.target = { x: 100, y: 100 }
      advanceUntilResting(system, follower)

      expect(follower.value.x).toBeCloseTo(125, 0)
      expect(follower.value.y).toBeCloseTo(90, 0)
    })

    test('follower lags behind leader', () => {
      const system = createSpringSystem()
      const leader = system.createSpring2D({ x: 0, y: 0 }, config)
      const follower = system.createSpring2D({ target: leader })

      leader.target = { x: 100, y: 100 }
      for (let i = 0; i < 5; i++) system.advance(1000 / 60)

      const leaderDist = Math.abs(leader.value.x - 100)
      const followerDist = Math.abs(follower.value.x - 100)
      expect(leaderDist).toBeLessThan(followerDist)
    })

    test('chaining: follower of follower', () => {
      const system = createSpringSystem()
      const a = system.createSpring2D({ x: 0, y: 0 }, config)
      const b = system.createSpring2D({ target: a })
      const c = system.createSpring2D({ target: b })

      a.target = { x: 100, y: 200 }
      advanceUntilResting(system, c)

      expect(c.value.x).toBeCloseTo(100, 0)
      expect(c.value.y).toBeCloseTo(200, 0)
    })

    test('can switch from standalone to following', () => {
      const system = createSpringSystem()
      const leader = system.createSpring2D({ x: 100, y: 100 }, config)
      const spring = system.createSpring2D({ x: 0, y: 0 }, config)

      spring.target = leader
      advanceUntilResting(system, spring)

      expect(spring.value.x).toBeCloseTo(100, 0)
      expect(spring.value.y).toBeCloseTo(100, 0)
    })

    test('can switch from following to standalone', () => {
      const system = createSpringSystem()
      const leader = system.createSpring2D({ x: 100, y: 100 }, config)
      const spring = system.createSpring2D({ target: leader })

      advanceUntilResting(system, spring)

      spring.target = { x: 0, y: 0 }
      advanceUntilResting(system, spring)

      expect(spring.value.x).toBeCloseTo(0, 0)
      expect(spring.value.y).toBeCloseTo(0, 0)
    })
  })

  describe('config inheritance', () => {
    test('inherits leader config by default', () => {
      const system = createSpringSystem()
      const leader = system.createSpring2D({ x: 0, y: 0 }, config)
      const follower = system.createSpring2D({ target: leader })

      expect(follower.tension).toBe(leader.tension)
      expect(follower.damping).toBe(leader.damping)
    })

    test('uses custom config when provided', () => {
      const system = createSpringSystem()
      const leader = system.createSpring2D({ x: 0, y: 0 }, config)
      const customConfig = defineSpring({ mass: 1, tension: 300, damping: 10 })
      const follower = system.createSpring2D({ target: leader }, customConfig)

      expect(follower.tension).toBe(300)
    })

    test('picks up leader config changes when no override', () => {
      const system = createSpringSystem()
      const leader = system.createSpring2D({ x: 0, y: 0 }, config)
      const follower = system.createSpring2D({ target: leader })

      leader.config = defineSpring({ mass: 1, tension: 300, damping: 30 })

      expect(follower.tension).toBe(300)
      expect(follower.damping).toBe(30)
    })

    test('setting config to null resumes inheritance', () => {
      const system = createSpringSystem()
      const leader = system.createSpring2D({ x: 0, y: 0 }, config)
      const follower = system.createSpring2D({ target: leader })

      follower.config = defineSpring({ mass: 1, tension: 400, damping: 20 })
      expect(follower.tension).toBe(400)

      follower.config = null
      expect(follower.tension).toBe(leader.tension)
    })
  })

  describe('events', () => {
    test('onUpdate fires when leader moves', () => {
      const system = createSpringSystem()
      const leader = system.createSpring2D({ x: 0, y: 0 }, config)
      const follower = system.createSpring2D({ target: leader })
      const callback = vi.fn()

      follower.onUpdate(callback)
      leader.target = { x: 100, y: 100 }
      system.advance(1000 / 60)

      expect(callback).toHaveBeenCalled()
    })

    test('onStop fires when fully settled', () => {
      const system = createSpringSystem()
      const leader = system.createSpring2D({ x: 0, y: 0 }, config)
      const follower = system.createSpring2D({
        target: leader,
        value: { x: 1, y: 1 },
      })

      const onStop = vi.fn()
      follower.onStop(onStop)

      advanceUntilResting(system, follower)

      expect(onStop).toHaveBeenCalled()
    })
  })

  describe('dispose', () => {
    test('follower stops following after dispose', () => {
      const system = createSpringSystem()
      const leader = system.createSpring2D({ x: 0, y: 0 }, config)
      const follower = system.createSpring2D({ target: leader })
      const callback = vi.fn()

      follower.onUpdate(callback)
      leader.target = { x: 50, y: 50 }
      system.advance(1000 / 60)
      const callCount = callback.mock.calls.length

      follower.dispose()
      leader.target = { x: 200, y: 200 }
      system.advance(1000 / 60)

      expect(callback.mock.calls.length).toBe(callCount)
    })
  })
})
