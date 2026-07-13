import { describe, expect, test, vi } from 'vitest'
import { createSpringSystem } from '../src/system.ts'
import { defineSpring } from '../src/config.ts'
import { SpringSourceSymbol, mapSpring } from '../src/spring-source.ts'
import { accelerationOf, velocityOf } from '../src/kinematic-source.ts'
import { advanceUntilResting } from './helpers.ts'

const config = defineSpring({ mass: 1, tension: 170, damping: 26 })

describe('velocityOf', () => {
  test('reads the source velocity exactly', () => {
    const system = createSpringSystem()
    const motion = system.createSpring(0, config)
    const source = velocityOf(motion)

    motion.target = 100
    system.advance(1000 / 60)

    expect(motion.velocity).toBeGreaterThan(0)
    expect(source[SpringSourceSymbol].value).toBe(motion.velocity)
  })

  test('a spring can follow another spring velocity', () => {
    const system = createSpringSystem()
    const motion = system.createSpring(0, config)
    const follower = system.createSpring(0)
    follower.target = velocityOf(motion)

    motion.target = 100

    let peak = 0
    for (let i = 0; i < 600; i++) {
      system.advance(1000 / 60)
      peak = Math.max(peak, Math.abs(follower.value))
      if (motion.isResting && follower.isResting) break
    }

    // The follower rode the leader's velocity up...
    expect(peak).toBeGreaterThan(0)
    // ...then settled as the leader came to rest and its velocity fell to 0.
    expect(follower.value).toBeCloseTo(0, 1)
    expect(follower.isResting).toBe(true)
  })

  test('mapSpring composes over a velocity source', () => {
    const system = createSpringSystem()
    const motion = system.createSpring(0, config)
    const speed = mapSpring(velocityOf(motion), (v) => Math.abs(v))

    motion.target = 100
    system.advance(1000 / 60)

    expect(speed[SpringSourceSymbol].value).toBe(Math.abs(motion.velocity))
  })

  test('updates when the source updates', () => {
    const system = createSpringSystem()
    const motion = system.createSpring(0, config)
    const source = velocityOf(motion)

    const seen = vi.fn()
    source[SpringSourceSymbol].onUpdate(seen)

    motion.target = 100
    system.advance(1000 / 60)

    expect(seen).toHaveBeenCalled()
  })

  test('releases with the source, detaching followers', () => {
    const system = createSpringSystem()
    const motion = system.createSpring(0, config)
    const follower = system.createSpring(0)
    follower.target = velocityOf(motion)

    motion.target = 100
    system.advance(1000 / 60)
    const held = follower.target
    expect(held).toBeGreaterThan(0)

    motion.dispose()
    advanceUntilResting(system, follower)

    // Detached, the follower keeps its last target and settles there.
    expect(follower.target).toBe(held)
    expect(follower.value).toBeCloseTo(held, 1)
  })
})

describe('accelerationOf', () => {
  test('reads the source acceleration exactly, matching the spring ODE', () => {
    const system = createSpringSystem()
    const motion = system.createSpring(0, config)
    const source = accelerationOf(motion)

    motion.target = 100
    system.advance(1000 / 60)

    // a = -(k*x + c*v) / m, with x the displacement from the target.
    const displacement = motion.value - motion.target
    const expected =
      -(motion.tension * displacement + motion.damping * motion.velocity) / motion.mass

    expect(motion.acceleration).not.toBe(0)
    expect(source[SpringSourceSymbol].value).toBe(motion.acceleration)
    expect(motion.acceleration).toBeCloseTo(expected, 6)
  })

  test('is zero at rest', () => {
    const system = createSpringSystem()
    const motion = system.createSpring(0, config)
    const source = accelerationOf(motion)

    motion.target = 100
    advanceUntilResting(system, motion)

    expect(motion.isResting).toBe(true)
    // Exactly zero magnitude (the sign of a zero is immaterial here).
    expect(Math.abs(source[SpringSourceSymbol].value)).toBe(0)
  })

  test('a spring can follow another spring acceleration, settling to rest', () => {
    const system = createSpringSystem()
    const motion = system.createSpring(0, config)
    const follower = system.createSpring(0)
    follower.target = accelerationOf(motion)

    motion.target = 100

    let peak = 0
    for (let i = 0; i < 600; i++) {
      system.advance(1000 / 60)
      peak = Math.max(peak, Math.abs(follower.value))
      if (motion.isResting && follower.isResting) break
    }

    expect(peak).toBeGreaterThan(0)
    expect(follower.value).toBeCloseTo(0, 1)
    expect(follower.isResting).toBe(true)
  })

  test('mapSpring composes over an acceleration source', () => {
    const system = createSpringSystem()
    const motion = system.createSpring(0, config)
    const impact = mapSpring(accelerationOf(motion), (a) => Math.abs(a))

    motion.target = 100
    system.advance(1000 / 60)

    expect(impact[SpringSourceSymbol].value).toBe(Math.abs(motion.acceleration))
  })
})

describe('kinematic sources: composites', () => {
  test('velocityOf yields a velocity of the same shape, mappable to a scalar', () => {
    const system = createSpringSystem()
    const point = system.createSpring({ x: 0, y: 0 }, config)
    const follower = system.createSpring(
      mapSpring(velocityOf(point), ({ x, y }) => Math.hypot(x, y)),
    )

    point.target = { x: 100, y: 100 }
    system.advance(1000 / 60)

    expect(follower.target).toBeCloseTo(Math.hypot(point.velocity.x, point.velocity.y), 6)
  })

  test('accelerationOf yields an acceleration of the same shape, mappable to a scalar', () => {
    const system = createSpringSystem()
    const point = system.createSpring({ x: 0, y: 0 }, config)
    const follower = system.createSpring(
      mapSpring(accelerationOf(point), ({ x, y }) => Math.hypot(x, y)),
    )

    point.target = { x: 100, y: 100 }
    system.advance(1000 / 60)

    expect(follower.target).toBeCloseTo(Math.hypot(point.acceleration.x, point.acceleration.y), 6)
  })

  test('a derivative source is a valid shape leaf alongside the value', () => {
    const system = createSpringSystem()
    const motion = system.createSpring(0, config)
    const follower = system.createSpring(
      mapSpring({ pos: motion, vel: velocityOf(motion) }, ({ pos, vel }) => pos + vel),
    )

    motion.target = 100
    system.advance(1000 / 60)

    expect(follower.target).toBe(motion.value + motion.velocity)
  })
})

describe('kinematic sources: rejection', () => {
  test('velocityOf throws on a mapped source, which is not in motion', () => {
    const system = createSpringSystem()
    const motion = system.createSpring(0, config)
    const mapped = mapSpring(motion, (v) => v * 2)

    expect(() => velocityOf(mapped as never)).toThrow(/in motion/)
  })

  test('accelerationOf throws on a mapped source, which is not in motion', () => {
    const system = createSpringSystem()
    const motion = system.createSpring(0, config)
    const mapped = mapSpring(motion, (v) => v * 2)

    expect(() => accelerationOf(mapped as never)).toThrow(/in motion/)
  })

  test('a derived velocity source has no motion of its own', () => {
    const system = createSpringSystem()
    const motion = system.createSpring(0, config)
    const source = velocityOf(motion)

    expect(() => velocityOf(source as never)).toThrow(/in motion/)
    expect(() => accelerationOf(source as never)).toThrow(/in motion/)
  })
})
