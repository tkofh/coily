import { afterEach, describe, expect, test, vi } from 'vitest'
import { createSpringSystem, defineSpring } from '../src/index.ts'
import { advanceUntilResting } from './helpers.ts'

const config = defineSpring({ mass: 1, tension: 170, damping: 26 })

function stubMatchMedia(initialMatches: boolean) {
  let listener: ((event: { matches: boolean }) => void) | undefined
  const query = {
    matches: initialMatches,
    addEventListener: (_type: string, callback: (event: { matches: boolean }) => void) => {
      listener = callback
    },
  }
  vi.stubGlobal('window', {
    matchMedia: vi.fn().mockReturnValue(query),
  })
  return {
    setMatches(matches: boolean) {
      listener?.({ matches })
    },
  }
}

describe('reduced motion: always', () => {
  test('retargets jump instantly to the target', () => {
    const system = createSpringSystem({ reducedMotion: 'always' })
    const spring = system.createSpring(0, config)

    spring.target = 100

    expect(spring.value).toBe(100)
    expect(spring.isResting).toBe(true)

    system.advance(1000 / 60)
    expect(spring.value).toBe(100)
  })

  test('emits one update and no start/stop on retarget', () => {
    const system = createSpringSystem({ reducedMotion: 'always' })
    const spring = system.createSpring(0, config)

    const onUpdate = vi.fn()
    const onStart = vi.fn()
    const onStop = vi.fn()
    spring.onUpdate(onUpdate)
    spring.onStart(onStart)
    spring.onStop(onStop)

    spring.target = 100

    expect(onUpdate).toHaveBeenCalledOnce()
    expect(onStart).not.toHaveBeenCalled()
    expect(onStop).not.toHaveBeenCalled()
  })

  test('settled resolves immediately after a retarget', async () => {
    const system = createSpringSystem({ reducedMotion: 'always' })
    const spring = system.createSpring(0, config)

    spring.target = 100
    await expect(spring.settled).resolves.toBeUndefined()
  })

  test('value writes move the spring instantly and stick', () => {
    const system = createSpringSystem({ reducedMotion: 'always' })
    const spring = system.createSpring(0, config)

    spring.value = 50

    expect(spring.value).toBe(50)
    expect(spring.target).toBe(50)
    expect(spring.isResting).toBe(true)
  })

  test('velocity impulses are ignored', () => {
    const system = createSpringSystem({ reducedMotion: 'always' })
    const spring = system.createSpring(0, config)

    spring.velocity = 500
    system.advance(1000 / 60)

    expect(spring.value).toBe(0)
    expect(spring.velocity).toBe(0)
    expect(spring.isResting).toBe(true)
  })

  test('followers collapse with their leader', () => {
    const system = createSpringSystem({ reducedMotion: 'always' })
    const leader = system.createSpring(0, config)
    const middle = system.createSpring(leader.value)
    middle.target = leader
    const tail = system.createSpring(middle.value)
    tail.target = middle

    leader.target = 100

    expect(middle.value).toBe(100)
    expect(tail.value).toBe(100)
    expect(tail.isResting).toBe(true)
  })

  test('followers of a ticking leader emit after every motion has advanced', () => {
    const system = createSpringSystem({ reducedMotion: 'always' })
    const ramp = system.createRamp(0, { rate: 1000, target: Infinity, purpose: 'nonmotion' })
    const a = system.createSpring(ramp)
    const b = system.createSpring(ramp)

    const events: string[] = []
    ramp.onUpdate(() => events.push(`ramp ${ramp.value}`))
    a.onUpdate(() => events.push(`a ${a.value} sees b ${b.value}`))
    b.onUpdate(() => events.push(`b ${b.value} sees a ${a.value}`))

    system.advance(16)
    expect(events).toEqual(['ramp 16', 'a 16 sees b 16', 'b 16 sees a 16'])

    events.length = 0
    system.advance(16)
    expect(events).toEqual(['ramp 32', 'a 32 sees b 32', 'b 32 sees a 32'])
  })

  test("followers of a moving 'nonmotion' spring emit after every motion has advanced", () => {
    const system = createSpringSystem({ reducedMotion: 'always' })
    const leader = system.createSpring(0, config, { purpose: 'nonmotion' })
    const a = system.createSpring(leader)
    const b = system.createSpring(leader)
    const seen: number[][] = []
    a.onUpdate(() => seen.push([leader.value, a.value, b.value]))

    leader.target = 100
    system.advance(1000 / 60)

    const value = leader.value
    expect(value).toBeGreaterThan(0)
    expect(seen).toEqual([[value, value, value]])
  })

  test('a chain behind a ticking leader lands on the leader in the same frame', () => {
    const system = createSpringSystem({ reducedMotion: 'always' })
    const ramp = system.createRamp(0, { rate: 1000, target: Infinity, purpose: 'nonmotion' })
    const middle = system.createSpring(ramp)
    const tail = system.createSpring(middle)

    const events: string[] = []
    const onStart = vi.fn()
    const onStop = vi.fn()
    ramp.onUpdate(() => events.push('ramp'))
    middle.onUpdate(() => events.push('middle'))
    tail.onUpdate(() => events.push(`tail ${ramp.value} ${middle.value} ${tail.value}`))
    middle.onStart(onStart)
    middle.onStop(onStop)
    tail.onStart(onStart)
    tail.onStop(onStop)

    system.advance(16)
    system.advance(16)

    expect(events).toEqual(['ramp', 'middle', 'tail 16 16 16', 'ramp', 'middle', 'tail 32 32 32'])
    expect(onStart).not.toHaveBeenCalled()
    expect(onStop).not.toHaveBeenCalled()
    expect(tail.isResting).toBe(true)
  })

  test('a follower jumps synchronously on a leader write outside a tick', () => {
    const system = createSpringSystem({ reducedMotion: 'always' })
    const leader = system.createSpring(0, config)
    const follower = system.createSpring(leader)
    const onUpdate = vi.fn()
    follower.onUpdate(onUpdate)

    leader.target = 100
    expect(follower.value).toBe(100)
    expect(onUpdate).toHaveBeenCalledOnce()

    // The jump already landed, so the next frame has nothing to report.
    system.advance(1000 / 60)
    expect(onUpdate).toHaveBeenCalledOnce()
  })

  test('composite springs jump on every channel', () => {
    const system = createSpringSystem({ reducedMotion: 'always' })
    const spring = system.createSpring({ x: 0, y: 0 }, config)

    spring.target = { x: 100, y: 200 }

    expect(spring.value).toEqual({ x: 100, y: 200 })
    expect(spring.isResting).toBe(true)
  })

  test('composite spring retargets emit one update and no start/stop', () => {
    const system = createSpringSystem({ reducedMotion: 'always' })
    const spring = system.createSpring({ x: 0, y: 0 }, config)

    const onUpdate = vi.fn()
    const onStart = vi.fn()
    const onStop = vi.fn()
    spring.onUpdate(onUpdate)
    spring.onStart(onStart)
    spring.onStop(onStop)

    spring.target = { x: 100, y: 200 }

    expect(onUpdate).toHaveBeenCalledOnce()
    expect(onStart).not.toHaveBeenCalled()
    expect(onStop).not.toHaveBeenCalled()
  })
})

describe("reduced motion: purpose 'nonmotion'", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('an nonmotion spring animates a retarget under reduced motion', () => {
    const system = createSpringSystem({ reducedMotion: 'always' })
    const spring = system.createSpring(0, config, { purpose: 'nonmotion' })

    spring.target = 100
    expect(spring.isResting).toBe(false)

    system.advance(1000 / 60)
    expect(spring.value).toBeGreaterThan(0)
    expect(spring.value).toBeLessThan(100)
  })

  test('value and velocity writes apply on an nonmotion spring under reduced motion', () => {
    const system = createSpringSystem({ reducedMotion: 'always' })

    const displaced = system.createSpring(0, config, { purpose: 'nonmotion' })
    displaced.value = 50
    expect(displaced.value).toBe(50)
    expect(displaced.target).toBe(0)
    system.advance(1000 / 60)
    expect(displaced.value).toBeLessThan(50)

    const flung = system.createSpring(0, config, { purpose: 'nonmotion' })
    flung.velocity = 500
    system.advance(1000 / 60)
    expect(flung.value).toBeGreaterThan(0)
  })

  test('nonmotion springs keep animating when the preference changes to reduce', () => {
    const media = stubMatchMedia(false)
    const system = createSpringSystem()
    const motion = system.createSpring(0, config)
    const nonmotion = system.createSpring(0, config, { purpose: 'nonmotion' })
    motion.target = 100
    nonmotion.target = 100

    system.advance(1000 / 60)
    expect(nonmotion.isResting).toBe(false)

    media.setMatches(true)

    // The motion spring snapped; the nonmotion spring is untouched.
    expect(motion.value).toBe(100)
    expect(motion.isResting).toBe(true)
    expect(nonmotion.isResting).toBe(false)
    expect(nonmotion.value).toBeLessThan(100)

    advanceUntilResting(system, nonmotion)
    expect(nonmotion.value).toBeCloseTo(100)
    expect(nonmotion.isResting).toBe(true)
  })

  test('purpose reads back from the spring', () => {
    const system = createSpringSystem()
    expect(system.createSpring(0).purpose).toBe('motion')
    expect(system.createSpring(0, config, { purpose: 'nonmotion' }).purpose).toBe('nonmotion')
  })

  test('a purpose shape exempts named channels only', () => {
    const system = createSpringSystem({ reducedMotion: 'always' })
    const spring = system.createSpring({ x: 0, y: 0, opacity: 1 }, config, {
      purpose: { opacity: 'nonmotion' },
    })

    spring.target = { x: 100, y: 200, opacity: 0 }
    // x and y snapped synchronously. Advance one frame to let opacity fade.
    system.advance(1000 / 60)

    const value = spring.value
    expect(value.x).toBe(100)
    expect(value.y).toBe(200)
    expect(value.opacity).toBeLessThan(1)
    expect(value.opacity).toBeGreaterThan(0)
    expect(spring.isResting).toBe(false)
    expect(spring.purpose).toBe(null)
  })

  test('a single purpose covers every channel', () => {
    const system = createSpringSystem({ reducedMotion: 'always' })
    const spring = system.createSpring({ x: 0, y: 0 }, config, { purpose: 'nonmotion' })

    spring.target = { x: 100, y: 200 }
    system.advance(1000 / 60)

    const value = spring.value
    expect(value.x).toBeGreaterThan(0)
    expect(value.x).toBeLessThan(100)
    expect(value.y).toBeGreaterThan(0)
    expect(value.y).toBeLessThan(200)
    expect(spring.purpose).toBe('nonmotion')
  })

  test('an invalid purpose in a shape throws with the channel path', () => {
    const system = createSpringSystem()
    expect(() =>
      // @ts-expect-error 'wiggle' is not a Purpose
      system.createSpring({ x: 0 }, config, { purpose: { x: 'wiggle' } }),
    ).toThrow(/purpose.*'x'/)
  })

  test("the removed 'appearance' purpose throws, naming the accepted words", () => {
    const system = createSpringSystem()
    expect(() =>
      // @ts-expect-error 'appearance' was renamed to 'nonmotion'
      system.createSpring(0, config, { purpose: 'appearance' }),
    ).toThrow("Spring purpose must be 'motion' or 'nonmotion'")
    expect(() =>
      // @ts-expect-error 'appearance' was renamed to 'nonmotion'
      system.createSpring({ x: 0 }, config, { purpose: 'appearance' }),
    ).toThrow("expected 'motion', 'nonmotion', or a purpose shape")
  })
})

describe('reduced motion: never and default', () => {
  test("'never' animates normally", () => {
    const system = createSpringSystem({ reducedMotion: 'never' })
    const spring = system.createSpring(0, config)

    spring.target = 100
    system.advance(1000 / 60)

    expect(spring.value).toBeGreaterThan(0)
    expect(spring.value).toBeLessThan(100)
    expect(system.reducedMotion).toBe(false)
  })

  test("default 'user' animates normally where matchMedia is unavailable", () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, config)

    spring.target = 100
    system.advance(1000 / 60)

    expect(spring.value).toBeGreaterThan(0)
    expect(spring.value).toBeLessThan(100)
    expect(system.reducedMotion).toBe(false)
  })
})

describe("reduced motion: 'user' media query", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('adopts the initial preference', () => {
    stubMatchMedia(true)
    const system = createSpringSystem()

    expect(system.reducedMotion).toBe(true)

    const spring = system.createSpring(0, config)
    spring.target = 100
    expect(spring.value).toBe(100)
  })

  test('finishes in-flight motions when the preference changes to reduce', () => {
    const media = stubMatchMedia(false)
    const system = createSpringSystem()
    const spring = system.createSpring(0, config)
    spring.target = 100

    system.advance(1000 / 60)
    expect(spring.isResting).toBe(false)

    media.setMatches(true)

    expect(system.reducedMotion).toBe(true)
    expect(spring.value).toBe(100)
    expect(spring.isResting).toBe(true)
  })

  test('finishes composite springs with one coalesced update and stop', () => {
    const media = stubMatchMedia(false)
    const system = createSpringSystem()
    const spring = system.createSpring({ x: 0, y: 0 }, config)
    spring.target = { x: 100, y: 200 }

    system.advance(1000 / 60)

    const onUpdate = vi.fn()
    const onStop = vi.fn()
    spring.onUpdate(onUpdate)
    spring.onStop(onStop)

    media.setMatches(true)

    expect(spring.value).toEqual({ x: 100, y: 200 })
    expect(onUpdate).toHaveBeenCalledOnce()
    expect(onStop).toHaveBeenCalledOnce()
  })

  function listen(spring: { onUpdate(f: () => void): unknown; onStop(f: () => void): unknown }) {
    const onUpdate = vi.fn()
    const onStop = vi.fn()
    spring.onUpdate(onUpdate)
    spring.onStop(onStop)
    return { onUpdate, onStop }
  }

  test('a follower of a moving leader finishes with one update and stop', () => {
    const media = stubMatchMedia(false)
    const system = createSpringSystem()
    const leader = system.createSpring(0, config)
    const follower = system.createSpring(leader)
    leader.target = 100
    system.advance(1000 / 60)

    const { onUpdate, onStop } = listen(follower)
    media.setMatches(true)

    expect(follower.value).toBe(100)
    expect(onUpdate).toHaveBeenCalledOnce()
    expect(onStop).toHaveBeenCalledOnce()
  })

  test('every spring in a chain of three finishes with one update and stop', () => {
    const media = stubMatchMedia(false)
    const system = createSpringSystem()
    const head = system.createSpring(0, config)
    const middle = system.createSpring(head)
    const tail = system.createSpring(middle)
    head.target = 100
    system.advance(1000 / 60)

    const springs = [head, middle, tail]
    const listeners = springs.map(listen)
    media.setMatches(true)

    for (const [i, spring] of springs.entries()) {
      expect(spring.value).toBe(100)
      expect(listeners[i]!.onUpdate).toHaveBeenCalledOnce()
      expect(listeners[i]!.onStop).toHaveBeenCalledOnce()
    }
  })

  test('a follower that started moving before its leader finishes once, on the leader', () => {
    const media = stubMatchMedia(false)
    const system = createSpringSystem()
    const leader = system.createSpring(0, config)
    const follower = system.createSpring(leader)
    // Displacing the follower first puts it ahead of its leader among the moving motions.
    follower.value = 5
    leader.target = 100
    system.advance(1000 / 60)

    const { onUpdate, onStop } = listen(follower)
    const values: number[] = []
    follower.onUpdate(() => values.push(follower.value))
    media.setMatches(true)

    expect(values).toEqual([100])
    expect(onUpdate).toHaveBeenCalledOnce()
    expect(onStop).toHaveBeenCalledOnce()
  })

  test('a follower of a moving ramp finishes with one update and stop', () => {
    const media = stubMatchMedia(false)
    const system = createSpringSystem()
    const ramp = system.createRamp(0, { rate: 100, target: 100 })
    const follower = system.createSpring(ramp)
    system.advance(1000 / 60)

    const { onUpdate, onStop } = listen(follower)
    media.setMatches(true)

    expect(follower.value).toBe(100)
    expect(onUpdate).toHaveBeenCalledOnce()
    expect(onStop).toHaveBeenCalledOnce()
  })

  test('resumes animating when the preference changes back', () => {
    const media = stubMatchMedia(true)
    const system = createSpringSystem()
    const spring = system.createSpring(0, config)

    media.setMatches(false)
    expect(system.reducedMotion).toBe(false)

    spring.target = 100
    system.advance(1000 / 60)
    expect(spring.value).toBeGreaterThan(0)
    expect(spring.value).toBeLessThan(100)
  })
})
