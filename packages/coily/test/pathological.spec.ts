import { describe, expect, test } from 'vitest'
import { defineSpring } from '../src/config.ts'
import { type SpringSource, mapSpring } from '../src/spring-source.ts'
import { createSpringSystem } from '../src/system.ts'

/**
 * Adversarial graphs and listeners: self-reference, cycles, thrown user
 * code, reentrant writes, and depth. These pin the containment
 * properties the machinery already relies on — retargets never re-emit,
 * config application early-outs on the resolved reference, and passes
 * recover after a throw — rather than exercising any dedicated guard
 * code.
 */

const config = defineSpring({ mass: 1, tension: 170, damping: 26 })
const stiff = defineSpring({ tension: 1000, dampingRatio: 1 })

const FRAME = 1000 / 60

function advanceUntilResting(
  system: ReturnType<typeof createSpringSystem>,
  spring: { isResting: boolean },
  maxFrames = 600,
) {
  for (let i = 0; i < maxFrames; i++) {
    system.advance(FRAME)
    if (spring.isResting) return
  }
}

describe('pathological graphs: self-reference', () => {
  test('a resting spring following itself stays put', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(50, config)

    spring.target = spring

    for (let i = 0; i < 10; i++) system.advance(FRAME)

    expect(spring.value).toBe(50)
    expect(spring.isResting).toBe(true)
  })

  test('a moving spring following itself decays to rest', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, config)
    spring.target = 100
    for (let i = 0; i < 5; i++) system.advance(FRAME)

    spring.target = spring
    advanceUntilResting(system, spring)

    expect(spring.isResting).toBe(true)
    expect(Number.isFinite(spring.value)).toBe(true)
  })

  test('a contracting self-map converges to its fixpoint', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(100, config)

    spring.target = mapSpring(spring, (value) => value / 2)
    advanceUntilResting(system, spring, 1200)

    expect(spring.isResting).toBe(true)
    expect(spring.value).toBeCloseTo(0, 0)
  })

  test('an expanding self-map chases forever without blowing up', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, config)

    spring.target = mapSpring(spring, (value) => value + 10)

    for (let i = 0; i < 120; i++) system.advance(FRAME)

    expect(spring.isResting).toBe(false)
    expect(spring.value).toBeGreaterThan(0)
    expect(Number.isFinite(spring.value)).toBe(true)
  })
})

describe('pathological graphs: cycles', () => {
  test('mutual followers converge to a shared value', () => {
    const system = createSpringSystem()
    const a = system.createSpring(0, config)
    const b = system.createSpring(100, config)

    b.target = a
    a.target = b

    for (let i = 0; i < 600; i++) {
      system.advance(FRAME)
      if (a.isResting && b.isResting) break
    }

    expect(a.isResting).toBe(true)
    expect(b.isResting).toBe(true)
    expect(a.value).toBeCloseTo(b.value, 1)
  })

  test('mutually expanding maps run away without crashing', () => {
    const system = createSpringSystem()
    const a = system.createSpring(0, config)
    const b = system.createSpring(0, config)

    a.target = mapSpring(b, (value) => value + 10)
    b.target = mapSpring(a, (value) => value + 10)

    for (let i = 0; i < 120; i++) system.advance(FRAME)

    expect(a.isResting).toBe(false)
    expect(a.value).toBeGreaterThan(0)
    expect(Number.isFinite(a.value)).toBe(true)
    expect(Number.isFinite(b.value)).toBe(true)
  })

  test('a configure cascade through a follow cycle terminates and sticks', () => {
    const system = createSpringSystem()
    const a = system.createSpring(0)
    const b = system.createSpring(0)
    a.target = b
    b.target = a

    a.config = stiff
    expect(a.config).toBe(stiff)
    expect(b.config).toBe(stiff)

    // Clearing a's own config falls back to its leader — which inherited
    // from a. The cycle makes the config sticky rather than looping.
    a.config = null
    expect(a.config).toBe(stiff)
    expect(b.config).toBe(stiff)
  })

  test('disposing inside a follow cycle detaches cleanly', () => {
    const system = createSpringSystem()
    const a = system.createSpring(0, config)
    const b = system.createSpring(100, config)
    a.target = b
    b.target = a

    a.dispose()

    b.target = 5
    advanceUntilResting(system, b)
    expect(b.value).toBeCloseTo(5, 0)
  })

  test('mutual composite followers converge channel-wise', () => {
    const system = createSpringSystem()
    const a = system.createSpring({ x: 0, y: 0 }, config)
    const b = system.createSpring({ x: 100, y: 200 }, config)

    b.target = a
    a.target = b

    for (let i = 0; i < 600; i++) {
      system.advance(FRAME)
      if (a.isResting && b.isResting) break
    }

    expect(a.isResting).toBe(true)
    expect(b.isResting).toBe(true)
    expect(a.value.x).toBeCloseTo(b.value.x, 1)
    expect(a.value.y).toBeCloseTo(b.value.y, 1)
  })

  test('a channel following a map of its own composite converges', () => {
    const system = createSpringSystem()
    const spring = system.createSpring({ x: 0, y: 0 }, config)

    spring.target = { y: 100 }
    // x follows y through the composite itself — a legal self-reference.
    spring.target = { x: mapSpring(spring, ({ y }) => y) }

    for (let i = 0; i < 600; i++) {
      system.advance(FRAME)
      if (spring.isResting) break
    }

    expect(spring.value.x).toBeCloseTo(100, 0)
    expect(spring.value.y).toBeCloseTo(100, 0)
  })

  test('config passthrough through a self-referential map converges', () => {
    const system = createSpringSystem()
    const spring = system.createSpring({ x: 0, y: 0 })

    // x adopts the composite's shared config through the map, and its
    // adoption feeds back into the resolution it adopted from.
    spring.target = { x: mapSpring(spring, ({ y }) => y) }

    // Reconfiguring y breaks the agreement mid-follow: the configure
    // event re-enters the composite through the map, and x must settle
    // on its default instead of oscillating.
    spring.config = { y: stiff }
    spring.target = { y: 50 }

    for (let i = 0; i < 600; i++) {
      system.advance(FRAME)
      if (spring.isResting) break
    }

    expect(spring.value.x).toBeCloseTo(50, 0)
    expect(spring.value.y).toBeCloseTo(50, 0)
  })

  test('a channel chasing an expanding map of itself stays contained', () => {
    const system = createSpringSystem()
    const spring = system.createSpring({ x: 0, y: 0 }, config)

    spring.target = { x: mapSpring(spring, ({ x }) => x + 10) }

    for (let i = 0; i < 120; i++) system.advance(FRAME)

    expect(spring.value.x).toBeGreaterThan(0)
    expect(Number.isFinite(spring.value.x)).toBe(true)
    expect(spring.value.y).toBe(0)
  })
})

describe('pathological listeners: thrown user code', () => {
  test('a map that throws surfaces at assignment', () => {
    const system = createSpringSystem()
    const leader = system.createSpring(0, config)
    const follower = system.createSpring(0)

    expect(() => {
      follower.target = mapSpring(leader, () => {
        throw new Error('boom')
      })
    }).toThrow('boom')
  })

  test('a map that throws mid-flight surfaces from advance, and the pass recovers', () => {
    const system = createSpringSystem()
    const leader = system.createSpring(0, config)
    const follower = system.createSpring(0)

    let boom = false
    follower.target = mapSpring(leader, (value) => {
      if (boom) {
        boom = false
        throw new Error('boom')
      }
      return value
    })
    boom = true

    leader.target = 100
    expect(() => system.advance(FRAME)).toThrow('boom')

    advanceUntilResting(system, follower)
    expect(follower.value).toBeCloseTo(100, 0)
  })

  test('a composite update listener that throws delays nothing past the next frame', () => {
    const system = createSpringSystem()
    const spring = system.createSpring({ x: 0 }, config)

    let boom = true
    spring.onUpdate(() => {
      if (boom) {
        boom = false
        throw new Error('boom')
      }
    })
    let updates = 0
    spring.onUpdate(() => {
      updates++
    })

    spring.target = { x: 100 }
    expect(() => system.advance(FRAME)).toThrow('boom')

    advanceUntilResting(system, spring)
    expect(updates).toBeGreaterThan(0)
    expect(spring.value.x).toBeCloseTo(100, 0)
  })
})

describe('pathological values', () => {
  test('a source that produces a non-finite value throws at the retarget', () => {
    const system = createSpringSystem()
    const leader = system.createSpring(0, config)
    const follower = system.createSpring(0)

    follower.target = mapSpring(leader, (value) => (value > 50 ? Number.NaN : value))
    leader.target = 100

    expect(() => {
      for (let i = 0; i < 600; i++) system.advance(FRAME)
    }).toThrow('Spring target must be a finite number')

    expect(Number.isFinite(follower.value)).toBe(true)
  })
})

describe('pathological listeners: reentrant writes', () => {
  test('a follower can retarget itself from its own update listener', () => {
    const system = createSpringSystem()
    const leader = system.createSpring(0, config)
    const follower = system.createSpring(leader)

    follower.onUpdate(() => {
      if (follower.value > 50) {
        follower.target = 0
      }
    })

    leader.target = 100
    advanceUntilResting(system, follower)

    expect(follower.isResting).toBe(true)
    expect(follower.value).toBeCloseTo(0, 0)
    expect(leader.value).toBeCloseTo(100, 0)
  })

  test('disposing the leader from an update listener mid-flight detaches cleanly', () => {
    const system = createSpringSystem()
    const leader = system.createSpring(0, config)
    const follower = system.createSpring(leader)

    follower.onUpdate(() => {
      if (follower.value > 50) {
        leader.dispose()
      }
    })

    leader.target = 100
    advanceUntilResting(system, follower)
    expect(follower.isResting).toBe(true)

    follower.target = 10
    advanceUntilResting(system, follower)
    expect(follower.value).toBeCloseTo(10, 0)
  })
})

describe('pathological depth', () => {
  test('a 100-link follow chain settles end to end', () => {
    const system = createSpringSystem()
    const head = system.createSpring(0, stiff)
    const links = [head]
    for (let i = 0; i < 99; i++) {
      links.push(system.createSpring(links[links.length - 1]!))
    }
    const tail = links[links.length - 1]!

    head.target = 100
    // The tail starts resting, so wait for the whole chain: the motion
    // wavefront takes many frames to arrive at the far end.
    for (let i = 0; i < 3000; i++) {
      system.advance(FRAME)
      if (links.every((link) => link.isResting)) break
    }

    expect(tail.isResting).toBe(true)
    expect(tail.value).toBeCloseTo(100, 0)
  })

  test('a 5000-deep map chain reads and follows without overflowing', () => {
    // Nesting getters would overflow the call stack near 600 maps; flat
    // composition keeps reads iterative at any depth.
    const system = createSpringSystem()
    const leader = system.createSpring(0, config)

    let source: SpringSource = leader
    for (let i = 0; i < 5000; i++) {
      source = mapSpring(source, (value) => value + 1)
    }

    const follower = system.createSpring(source)
    expect(follower.value).toBe(5000)

    leader.target = 100
    advanceUntilResting(system, follower, 1200)
    expect(follower.value).toBeCloseTo(5100, 0)
  })
})
