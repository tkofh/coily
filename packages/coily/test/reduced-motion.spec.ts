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

describe("reduced motion: purpose 'appearance'", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('an appearance spring animates a retarget under reduced motion', () => {
    const system = createSpringSystem({ reducedMotion: 'always' })
    const spring = system.createSpring(0, config, { purpose: 'appearance' })

    spring.target = 100
    expect(spring.isResting).toBe(false)

    system.advance(1000 / 60)
    expect(spring.value).toBeGreaterThan(0)
    expect(spring.value).toBeLessThan(100)
  })

  test('value and velocity writes apply on an appearance spring under reduced motion', () => {
    const system = createSpringSystem({ reducedMotion: 'always' })

    const displaced = system.createSpring(0, config, { purpose: 'appearance' })
    displaced.value = 50
    expect(displaced.value).toBe(50)
    expect(displaced.target).toBe(0)
    system.advance(1000 / 60)
    expect(displaced.value).toBeLessThan(50)

    const flung = system.createSpring(0, config, { purpose: 'appearance' })
    flung.velocity = 500
    system.advance(1000 / 60)
    expect(flung.value).toBeGreaterThan(0)
  })

  test('appearance springs keep animating when the preference changes to reduce', () => {
    const media = stubMatchMedia(false)
    const system = createSpringSystem()
    const motion = system.createSpring(0, config)
    const appearance = system.createSpring(0, config, { purpose: 'appearance' })
    motion.target = 100
    appearance.target = 100

    system.advance(1000 / 60)
    expect(appearance.isResting).toBe(false)

    media.setMatches(true)

    // The motion spring snapped; the appearance spring is untouched.
    expect(motion.value).toBe(100)
    expect(motion.isResting).toBe(true)
    expect(appearance.isResting).toBe(false)
    expect(appearance.value).toBeLessThan(100)

    advanceUntilResting(system, appearance)
    expect(appearance.value).toBeCloseTo(100)
    expect(appearance.isResting).toBe(true)
  })

  test('purpose reads back from the spring', () => {
    const system = createSpringSystem()
    expect(system.createSpring(0).purpose).toBe('motion')
    expect(system.createSpring(0, config, { purpose: 'appearance' }).purpose).toBe('appearance')
  })

  test('a purpose shape exempts named channels only', () => {
    const system = createSpringSystem({ reducedMotion: 'always' })
    const spring = system.createSpring({ x: 0, y: 0, opacity: 1 }, config, {
      purpose: { opacity: 'appearance' },
    })

    spring.target = { x: 100, y: 200, opacity: 0 }
    // x and y snapped synchronously; advance one frame to let opacity fade.
    system.advance(1000 / 60)

    const value = spring.value
    // Motion channels snapped; the appearance channel is still fading.
    expect(value.x).toBe(100)
    expect(value.y).toBe(200)
    expect(value.opacity).toBeLessThan(1)
    expect(value.opacity).toBeGreaterThan(0)
    expect(spring.isResting).toBe(false)
    expect(spring.purpose).toBe(null)
  })

  test('a single purpose covers every channel', () => {
    const system = createSpringSystem({ reducedMotion: 'always' })
    const spring = system.createSpring({ x: 0, y: 0 }, config, { purpose: 'appearance' })

    spring.target = { x: 100, y: 200 }
    system.advance(1000 / 60)

    const value = spring.value
    expect(value.x).toBeGreaterThan(0)
    expect(value.x).toBeLessThan(100)
    expect(value.y).toBeGreaterThan(0)
    expect(value.y).toBeLessThan(200)
    expect(spring.purpose).toBe('appearance')
  })

  test('an invalid purpose in a shape throws with the channel path', () => {
    const system = createSpringSystem()
    expect(() =>
      // @ts-expect-error — 'wiggle' is not a Purpose
      system.createSpring({ x: 0 }, config, { purpose: { x: 'wiggle' } }),
    ).toThrow(/purpose.*'x'/)
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
