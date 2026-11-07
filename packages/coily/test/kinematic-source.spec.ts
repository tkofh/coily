import { describe, expect, vi } from 'vitest'
import { defineSpring } from '../src/config.ts'
import { SpringSourceSymbol, mapSpring } from '../src/spring-source.ts'
import {
  type KinematicSource,
  accelerationOf,
  targetOf,
  velocityOf,
} from '../src/kinematic-source.ts'
import { createSpringSystem } from '../src/system.ts'
import { FRAME, advanceUntilResting, test } from './helpers.ts'

const config = defineSpring({ mass: 1, tension: 170, damping: 26 })

describe('velocityOf', () => {
  test('reads the source velocity exactly', ({ system }) => {
    const motion = system.createSpring(0, config)
    const source = velocityOf(motion)

    motion.target = 100
    system.advance(1000 / 60)

    expect(motion.velocity).toBeGreaterThan(0)
    expect(source[SpringSourceSymbol].value).toBe(motion.velocity)
  })

  test('a spring can follow another spring velocity', ({ system }) => {
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

    // The follower tracked the leader's velocity up, then settled as the
    // leader came to rest and its velocity fell to 0.
    expect(peak).toBeGreaterThan(0)
    expect(follower.value).toBeCloseTo(0, 1)
    expect(follower.isResting).toBe(true)
  })

  test('mapSpring composes over a velocity source', ({ system }) => {
    const motion = system.createSpring(0, config)
    const speed = mapSpring(velocityOf(motion), (v) => Math.abs(v))

    motion.target = 100
    system.advance(1000 / 60)

    expect(speed[SpringSourceSymbol].value).toBe(Math.abs(motion.velocity))
  })

  test('updates when the source updates', ({ system }) => {
    const motion = system.createSpring(0, config)
    const source = velocityOf(motion)

    const seen = vi.fn()
    source[SpringSourceSymbol].onUpdate(seen)

    motion.target = 100
    system.advance(1000 / 60)

    expect(seen).toHaveBeenCalled()
  })

  test('releases with the source, detaching followers', ({ system }) => {
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
  test('reads the source acceleration exactly, matching the spring ODE', ({ system }) => {
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

  test('is zero at rest', ({ system }) => {
    const motion = system.createSpring(0, config)
    const source = accelerationOf(motion)

    motion.target = 100
    advanceUntilResting(system, motion)

    expect(motion.isResting).toBe(true)
    // Exactly zero magnitude (the sign of a zero is immaterial here).
    expect(Math.abs(source[SpringSourceSymbol].value)).toBe(0)
  })

  test('a spring can follow another spring acceleration, settling to rest', ({ system }) => {
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

  test('mapSpring composes over an acceleration source', ({ system }) => {
    const motion = system.createSpring(0, config)
    const impact = mapSpring(accelerationOf(motion), (a) => Math.abs(a))

    motion.target = 100
    system.advance(1000 / 60)

    expect(impact[SpringSourceSymbol].value).toBe(Math.abs(motion.acceleration))
  })
})

describe('targetOf', () => {
  test('reads the spring target live, before the spring moves', ({ system }) => {
    const motion = system.createSpring(0, config)
    const source = targetOf(motion)

    motion.target = 100
    expect(source[SpringSourceSymbol].value).toBe(100)

    system.advance(FRAME)
    expect(source[SpringSourceSymbol].value).toBe(100)
  })

  test('followers pick up a retarget from rest on the next frame', ({ system }) => {
    const body = system.createSpring(0, config)
    const remaining = mapSpring(
      { value: body, target: targetOf(body) },
      ({ value, target }) => target - value,
    )
    const follower = system.createSpring(remaining)

    body.target = 100
    // The retarget emits nothing until the frame where the body moves.
    expect(follower.target).toBe(0)

    system.advance(FRAME)
    expect(follower.target).toBe(body.target - body.value)
    expect(follower.target).toBeGreaterThan(0)

    advanceUntilResting(system, follower)
    expect(follower.target).toBe(0)
    expect(follower.isResting).toBe(true)
  })

  test('the documented lead example', () => {
    const system = createSpringSystem({ reducedMotion: 'never' })
    const body = system.createSpring(0)
    const lead = mapSpring({ value: body, target: targetOf(body) }, ({ value, target }) =>
      Math.max(-20, Math.min(20, target - value)),
    )
    const eyes = system.createSpring(lead)

    body.target = 100
    system.advance(100)

    expect(body.target - body.value).toBeGreaterThan(20)
    expect(eyes.target).toBe(20)
  })

  test('tracks a spring that is itself following', ({ system }) => {
    const leader = system.createSpring(0, config)
    const motion = system.createSpring(leader, config)
    const follower = system.createSpring(targetOf(motion))

    leader.target = 50
    system.advance(FRAME)

    expect(motion.target).toBe(leader.value)
    expect(follower.target).toBe(motion.target)
  })

  test('a composite yields a target of the same shape, mappable to a scalar', ({ system }) => {
    const point = system.createSpring({ x: 0, y: 0 }, config)
    const follower = system.createSpring(mapSpring(targetOf(point), ({ x, y }) => Math.hypot(x, y)))

    point.target = { x: 30, y: 40 }
    system.advance(FRAME)

    expect(follower.target).toBe(50)
  })

  test('releases with the spring, detaching followers', ({ system }) => {
    const motion = system.createSpring(0, config)
    const follower = system.createSpring(targetOf(motion))

    motion.target = 100
    system.advance(FRAME)
    expect(follower.target).toBe(100)

    motion.dispose()
    advanceUntilResting(system, follower)

    expect(follower.target).toBe(100)
  })

  test('throws on a mapped source, which has no target', ({ system }) => {
    const motion = system.createSpring(0, config)
    const mapped = mapSpring(motion, (v) => v * 2)

    expect(() => targetOf(mapped as never)).toThrow(/no target/)
    expect(() => targetOf(velocityOf(motion) as never)).toThrow(/no target/)
  })
})

describe('kinematic sources: composites', () => {
  test('velocityOf yields a velocity of the same shape, mappable to a scalar', ({ system }) => {
    const point = system.createSpring({ x: 0, y: 0 }, config)
    const follower = system.createSpring(
      mapSpring(velocityOf(point), ({ x, y }) => Math.hypot(x, y)),
    )

    point.target = { x: 100, y: 100 }
    system.advance(1000 / 60)

    expect(follower.target).toBeCloseTo(Math.hypot(point.velocity.x, point.velocity.y), 6)
  })

  test('accelerationOf yields an acceleration of the same shape, mappable to a scalar', ({
    system,
  }) => {
    const point = system.createSpring({ x: 0, y: 0 }, config)
    const follower = system.createSpring(
      mapSpring(accelerationOf(point), ({ x, y }) => Math.hypot(x, y)),
    )

    point.target = { x: 100, y: 100 }
    system.advance(1000 / 60)

    expect(follower.target).toBeCloseTo(Math.hypot(point.acceleration.x, point.acceleration.y), 6)
  })

  test('a derivative source is a valid shape leaf alongside the value', ({ system }) => {
    const motion = system.createSpring(0, config)
    const follower = system.createSpring(
      mapSpring({ pos: motion, vel: velocityOf(motion) }, ({ pos, vel }) => pos + vel),
    )

    motion.target = 100
    system.advance(1000 / 60)

    expect(follower.target).toBe(motion.value + motion.velocity)
  })
})

describe('kinematic sources: flattening', () => {
  test('a wrapper and its source at separate shape leaves subscribe once', ({ system }) => {
    let current = 3
    let subscriptions = 0
    const listeners = new Set<() => void>()
    const source: KinematicSource = {
      [SpringSourceSymbol]: {
        get value() {
          return current
        },
        // Fixed derivatives keep the combined read easy to assert.
        velocity: 7,
        acceleration: 0,
        onUpdate: (callback) => {
          subscriptions++
          listeners.add(callback)
          return () => listeners.delete(callback)
        },
        onDispose: () => () => {},
      },
    }

    const follower = system.createSpring(0)
    follower.target = mapSpring(
      { pos: source, vel: velocityOf(source) },
      ({ pos, vel }) => pos + vel,
    )

    // `velocityOf` flattens to its source, so both leaves share one root.
    expect(subscriptions).toBe(1)
    expect(follower.target).toBe(10)

    current = 20
    for (const callback of listeners) callback()
    expect(follower.target).toBe(27)
  })
})

describe('kinematic sources: rejection', () => {
  test('velocityOf throws on a mapped source, which is not in motion', ({ system }) => {
    const motion = system.createSpring(0, config)
    const mapped = mapSpring(motion, (v) => v * 2)

    expect(() => velocityOf(mapped as never)).toThrow(/in motion/)
  })

  test('accelerationOf throws on a mapped source, which is not in motion', ({ system }) => {
    const motion = system.createSpring(0, config)
    const mapped = mapSpring(motion, (v) => v * 2)

    expect(() => accelerationOf(mapped as never)).toThrow(/in motion/)
  })

  test('a derived velocity source has no motion of its own', ({ system }) => {
    const motion = system.createSpring(0, config)
    const source = velocityOf(motion)

    expect(() => velocityOf(source as never)).toThrow(/in motion/)
    expect(() => accelerationOf(source as never)).toThrow(/in motion/)
  })

  test('the rejections name every source that qualifies, ramps included', ({ system }) => {
    const motion = system.createSpring(0, config)
    const mapped = mapSpring(motion, (v) => v * 2)
    const qualifying = '(a Spring, CompositeSpring, or Ramp)'

    expect(() => velocityOf(mapped as never)).toThrow(qualifying)
    expect(() => accelerationOf(mapped as never)).toThrow(qualifying)
    expect(() => targetOf(mapped as never)).toThrow(qualifying)
  })
})
