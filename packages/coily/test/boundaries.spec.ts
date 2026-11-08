import { describe, expect, test } from 'vitest'
import { defineSpring } from '../src/config.ts'
import { mapSpring } from '../src/spring-source.ts'
import { createSpringSystem } from '../src/system.ts'
import { FRAME, advanceUntilResting, flush } from './helpers.ts'

/**
 * The invariants the tick's phases and ownership promise: a motion moves
 * only when its own system advances, listeners run only in the settle
 * sweep or synchronously from a write, and a throwing listener never
 * strands internal lifecycle state.
 */

const loose = { couplingTolerance: 1e9, reducedMotion: 'never' } as const

describe('ownership: following across systems', () => {
  const leaders = {
    spring: (system: ReturnType<typeof createSpringSystem>) => {
      const leader = system.createSpring(0)
      return { source: leader, move: () => (leader.target = 100) }
    },
    ramp: (system: ReturnType<typeof createSpringSystem>) => {
      const leader = system.createRamp(0, { rate: 600 })
      return { source: leader, move: () => (leader.target = 100) }
    },
    'mapped spring': (system: ReturnType<typeof createSpringSystem>) => {
      const leader = system.createSpring(0)
      return { source: mapSpring(leader, (v) => v * 2), move: () => (leader.target = 50) }
    },
  }

  for (const [kind, make] of Object.entries(leaders)) {
    for (const order of ['owner first', 'follower first'] as const) {
      test(`a ${kind} leader moves a foreign follower only when the follower's system advances (${order})`, () => {
        const a = createSpringSystem(loose)
        const b = createSpringSystem(loose)
        const { source, move } = make(a)
        // A same-system follower puts the leader in a's follow graph too.
        const local = a.createSpring(source)
        const foreign = b.createSpring(source)
        const second = b.createSpring(source)
        a.advance(0)
        b.advance(0)

        // a's frames retarget b's followers through the leader's events.
        // The rebase keeps each value, up to the rounding of
        // `target + (value - target)`.
        const expectHeld = (spring: { value: number }, before: number) => {
          expect(spring.value).toBeCloseTo(before, 12)
        }

        move()
        for (let i = 0; i < 400; i++) {
          if (order === 'owner first') {
            const before = [foreign.value, second.value] as const
            a.advance(FRAME)
            expectHeld(foreign, before[0])
            expectHeld(second, before[1])
            b.advance(FRAME)
          } else {
            b.advance(FRAME)
            const after = foreign.value
            a.advance(FRAME)
            expectHeld(foreign, after)
          }
        }

        expect(local.isResting).toBe(true)
        expect(foreign.isResting).toBe(true)
        expect(foreign.value).toBe(local.value)
        expect(second.value).toBe(local.value)
      })
    }
  }

  test('a resting foreign follower stays still while the leader system advances', () => {
    const a = createSpringSystem(loose)
    const b = createSpringSystem(loose)
    const leader = a.createSpring(0)
    a.createSpring(leader)
    const foreign = b.createSpring(leader)

    leader.target = 100
    for (let i = 0; i < 30; i++) a.advance(FRAME)

    // The follower retargeted from the leader's updates but never advanced.
    expect(foreign.value).toBe(0)
    expect(foreign.target).toBe(leader.value)
  })
})

describe('event phases: recoupling stays silent', () => {
  function stopAtCrossing() {
    const system = createSpringSystem(loose)
    const leader = system.createSpring(0)
    // `arrival: 0` routes the recouple through the held-target rebase.
    const follower = system.createSpring(
      leader,
      defineSpring({ duration: 500, dampingRatio: 1, arrival: 0 }),
    )
    return { system, leader, follower }
  }

  test('a follower that wakes in a recouple starts in the settle sweep', () => {
    const { system, leader, follower } = stopAtCrossing()
    const seen: number[] = []
    follower.onStart(() => seen.push(follower.value))

    leader.target = 100
    system.advance(FRAME)

    // Fired once, after the follower advanced: it reads the frame's value.
    expect(seen).toHaveLength(1)
    expect(seen[0]).toBe(follower.value)
    expect(seen[0]).toBeGreaterThan(0)
  })

  test('a start listener can dispose the follower', () => {
    const { system, leader, follower } = stopAtCrossing()
    follower.onStart(() => follower.dispose())

    leader.target = 100
    expect(() => system.advance(FRAME)).not.toThrow()
    advanceUntilResting(system, leader)
    expect(leader.value).toBe(100)
  })

  test('a start listener can retarget the follower', () => {
    const { system, leader, follower } = stopAtCrossing()
    follower.onStart(() => (follower.target = -50))

    leader.target = 100
    system.advance(FRAME)
    advanceUntilResting(system, follower)
    expect(follower.value).toBe(-50)
  })

  test('a start listener that throws once leaves the follower running', () => {
    const { system, leader, follower } = stopAtCrossing()
    let boom = true
    follower.onStart(() => {
      if (boom) {
        boom = false
        throw new Error('boom')
      }
    })

    leader.target = 100
    expect(() => system.advance(FRAME)).toThrow('boom')
    advanceUntilResting(system, follower)
    expect(follower.value).toBe(100)
  })

  for (const nested of [0, FRAME]) {
    test(`a nested advance(${nested === 0 ? 0 : 'FRAME'}) from a start listener keeps every other motion's elapsed time`, () => {
      const { system, leader, follower } = stopAtCrossing()
      const bystander = system.createSpring(0)
      const reference = createSpringSystem(loose).createSpring(0)
      let nestedRuns = 0
      follower.onStart(() => {
        nestedRuns++
        system.advance(nested)
      })

      bystander.target = 100
      reference.target = 100
      leader.target = 100
      system.advance(FRAME)
      const referenceSystem = createSpringSystem(loose)
      const replay = referenceSystem.createSpring(0)
      replay.target = 100
      referenceSystem.advance(FRAME)
      if (nested > 0) referenceSystem.advance(nested)

      expect(nestedRuns).toBe(1)
      expect(bystander.value).toBe(replay.value)
    })
  }

  test('advancing from map code throws instead of interleaving passes', () => {
    const system = createSpringSystem(loose)
    const leader = system.createSpring(0)
    let reenter = false
    const follower = system.createSpring(
      mapSpring(leader, (v) => {
        if (reenter) system.advance(0)
        return v
      }),
    )
    leader.target = 100
    reenter = true
    expect(() => system.advance(FRAME)).toThrow('while it is advancing')
    reenter = false
    advanceUntilResting(system, follower)
    expect(follower.value).toBe(100)
  })
})

describe('event phases: a throwing terminal update', () => {
  const kinds = {
    spring: (system: ReturnType<typeof createSpringSystem>) => {
      const spring = system.createSpring(0)
      spring.target = 1
      return spring
    },
    ramp: (system: ReturnType<typeof createSpringSystem>) =>
      system.createRamp(0, { rate: 10, target: 1 }),
    composite: (system: ReturnType<typeof createSpringSystem>) => {
      const spring = system.createSpring({ x: 0, y: 0 })
      spring.target = { x: 1, y: 2 }
      return spring
    },
  }

  for (const [kind, make] of Object.entries(kinds)) {
    test(`a ${kind} still stops and settles when its last update listener throws`, async () => {
      const system = createSpringSystem(loose)
      const motion = make(system)
      let settled = false
      let stops = 0
      void motion.settled.then(() => (settled = true))
      motion.onStop(() => stops++)
      let thrown = 0
      motion.onUpdate(() => {
        if (motion.isResting && thrown++ === 0) throw new Error('boom')
      })

      let errors = 0
      for (let i = 0; i < 400 && !motion.isResting; i++) {
        try {
          system.advance(FRAME)
        } catch {
          errors++
        }
      }
      await flush()

      expect(errors).toBe(1)
      expect(motion.isResting).toBe(true)
      expect(stops).toBe(1)
      expect(settled).toBe(true)
    })
  }

  test('motions finishing in the same frame all settle when one listener throws', async () => {
    const system = createSpringSystem(loose)
    const springs = [0, 1, 2].map(() => system.createSpring(0))
    for (const spring of springs) spring.target = 1
    springs[0]!.onUpdate(() => {
      if (springs[0]!.isResting) throw new Error('first')
    })
    springs[2]!.onUpdate(() => {
      if (springs[2]!.isResting) throw new Error('last')
    })
    const settled = springs.map((spring) => spring.settled)
    let stops = 0
    for (const spring of springs) spring.onStop(() => stops++)

    let caught: unknown
    for (let i = 0; i < 400 && caught === undefined; i++) {
      try {
        system.advance(FRAME)
      } catch (error) {
        caught = error
      }
    }

    expect(caught).toBeInstanceOf(AggregateError)
    expect((caught as AggregateError).message).toContain('the first: first')
    expect((caught as AggregateError).errors.map((e: Error) => e.message)).toEqual([
      'first',
      'last',
    ])
    expect(stops).toBe(3)
    await expect(Promise.all(settled)).resolves.toBeDefined()
  })

  test('a throwing stop listener does not keep settled pending', async () => {
    const system = createSpringSystem(loose)
    const spring = system.createSpring(0)
    spring.target = 1
    spring.onStop(() => {
      throw new Error('boom')
    })
    const settled = spring.settled

    expect(() => advanceUntilResting(system, spring)).toThrow('boom')
    expect(spring.isResting).toBe(true)
    await expect(settled).resolves.toBeUndefined()
  })
})
