import { afterEach, describe, expect, test, vi } from 'vitest'
import { createSpringSystem, defineSpring } from '../src/index.ts'

const config = defineSpring({ mass: 1, tension: 170, damping: 26 })

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

  test('a displaced spring is created at its target', () => {
    const system = createSpringSystem({ reducedMotion: 'always' })
    const spring = system.createSpring({ target: 100, value: 0 }, config)

    expect(spring.value).toBe(100)
    expect(spring.isResting).toBe(true)
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
    const middle = system.createSpring({ target: leader })
    const tail = system.createSpring({ target: middle })

    leader.target = 100

    expect(middle.value).toBe(100)
    expect(tail.value).toBe(100)
    expect(tail.isResting).toBe(true)
  })

  test('2d springs jump on both axes', () => {
    const system = createSpringSystem({ reducedMotion: 'always' })
    const spring = system.createSpring2D({ x: 0, y: 0 }, config)

    spring.target = { x: 100, y: 200 }

    expect(spring.value).toEqual({ x: 100, y: 200 })
    expect(spring.isResting).toBe(true)
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
    const spring = system.createSpring({ target: 100, value: 0 }, config)

    system.advance(1000 / 60)
    expect(spring.isResting).toBe(false)

    media.setMatches(true)

    expect(system.reducedMotion).toBe(true)
    expect(spring.value).toBe(100)
    expect(spring.isResting).toBe(true)
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
