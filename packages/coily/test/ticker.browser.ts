import { describe, expect, test } from 'vitest'
import { createSpringSystem, defineSpring } from '../src/index.ts'

function waitForStop(spring: { onStop: (cb: () => void) => () => void }, timeout = 5000) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Spring did not settle in time')), timeout)
    spring.onStop(() => {
      clearTimeout(timer)
      resolve()
    })
  })
}

function frames(n: number) {
  return new Promise<void>((resolve) => {
    let count = 0
    function step() {
      if (++count >= n) {
        resolve()
      } else {
        requestAnimationFrame(step)
      }
    }
    requestAnimationFrame(step)
  })
}

function blockMainThread(ms: number) {
  const end = performance.now() + ms
  while (performance.now() < end) {
    /* busy wait */
  }
}

const defaultConfig = defineSpring({ mass: 1, tension: 170, damping: 26 })

describe('ticker with requestAnimationFrame', () => {
  test('start() drives spring updates via rAF', async () => {
    const system = createSpringSystem({ reducedMotion: 'never' })
    const spring = system.createSpring(100, defaultConfig)
    spring.target = 0

    system.start()
    await frames(5)
    system.stop()

    expect(spring.value).not.toBe(100)
    spring.dispose()
  })

  test('spring settles to target', async () => {
    const system = createSpringSystem({ reducedMotion: 'never' })
    const spring = system.createSpring(50, defaultConfig)
    spring.target = 0

    const settled = waitForStop(spring)
    system.start()
    await settled
    system.stop()

    expect(spring.value).toBe(0)
    expect(spring.isResting).toBe(true)
    spring.dispose()
  })

  test('stop() halts the animation loop', async () => {
    const system = createSpringSystem({ reducedMotion: 'never' })
    const spring = system.createSpring(100, defaultConfig)
    spring.target = 0

    system.start()
    await frames(3)
    system.stop()

    const frozenValue = spring.value
    await frames(5)

    expect(spring.value).toBe(frozenValue)
    spring.dispose()
  })

  test('multiple springs settle independently', async () => {
    const system = createSpringSystem({ reducedMotion: 'never' })
    const springA = system.createSpring(0, defaultConfig)
    springA.target = 50
    const springB = system.createSpring(0, defineSpring({ mass: 1, tension: 80, damping: 20 }))
    springB.target = -30

    const settledA = waitForStop(springA)
    const settledB = waitForStop(springB)

    system.start()
    await Promise.all([settledA, settledB])
    system.stop()

    expect(springA.value).toBe(50)
    expect(springB.value).toBe(-30)
    springA.dispose()
    springB.dispose()
  })

  test('changing target mid-animation settles at new target', async () => {
    const system = createSpringSystem({ reducedMotion: 'never' })
    const spring = system.createSpring(0, defaultConfig)
    spring.target = 100

    system.start()
    await frames(5)

    spring.target = -50

    const settled = waitForStop(spring)
    await settled
    system.stop()

    expect(spring.value).toBe(-50)
    spring.dispose()
  })

  test('dispose() during animation does not cause errors', async () => {
    const system = createSpringSystem({ reducedMotion: 'never' })
    const springA = system.createSpring(0, defaultConfig)
    springA.target = 100
    const springB = system.createSpring(0, defaultConfig)
    springB.target = 50

    const settledB = waitForStop(springB)

    system.start()
    await frames(3)
    springA.dispose()

    await settledB
    system.stop()

    expect(springB.value).toBe(50)
    springB.dispose()
  })

  test('onUpdate fires each frame during animation', async () => {
    const system = createSpringSystem({ reducedMotion: 'never' })
    const spring = system.createSpring(100, defaultConfig)
    spring.target = 0

    let updateCount = 0
    spring.onUpdate(() => {
      updateCount++
    })

    const settled = waitForStop(spring)
    system.start()
    await settled
    system.stop()

    expect(updateCount).toBeGreaterThan(1)
    spring.dispose()
  })

  test('lag spike is clamped to adjustedLag', async () => {
    const springOpts = defineSpring({ mass: 1, tension: 170, damping: 26 })

    // System with a low lagThreshold so our busy-wait triggers clamping
    const clamped = createSpringSystem({
      lagThreshold: 30,
      adjustedLag: 16,
      reducedMotion: 'never',
    })
    const clampedSpring = clamped.createSpring(100, springOpts)
    clampedSpring.target = 0

    // Reference system: manually advanced by exactly adjustedLag
    const reference = createSpringSystem({ reducedMotion: 'never' })
    const refSpring = reference.createSpring(100, springOpts)
    refSpring.target = 0

    // Let the clamped system run a few normal frames to establish timing
    clamped.start()
    await frames(3)

    // Record value before the spike
    const valueBeforeSpike = clampedSpring.value

    // Block the main thread for well over the lagThreshold.
    // The next rAF callback will see a wallElapsed of ~200ms,
    // but the ticker should clamp it to adjustedLag (16ms).
    blockMainThread(200)

    // Let the rAF fire after the block
    await frames(2)
    clamped.stop()

    const clampedValue = clampedSpring.value

    // Advance the reference spring by the same number of frames
    // as if no clamping occurred (i.e., with the full 200ms elapsed).
    // If lag was NOT clamped, the spring would have jumped much further.
    const unclamped = createSpringSystem({ reducedMotion: 'never' })
    const unclampedSpring = unclamped.createSpring(valueBeforeSpike, springOpts)
    unclampedSpring.target = 0
    unclamped.advance(200)
    const unclampedValue = unclampedSpring.value

    // The clamped spring should be closer to its pre-spike value
    // than a spring that received the full 200ms of elapsed time
    const clampedDistance = Math.abs(clampedValue - valueBeforeSpike)
    const unclampedDistance = Math.abs(unclampedValue - valueBeforeSpike)

    expect(clampedDistance).toBeLessThan(unclampedDistance)

    clampedSpring.dispose()
    refSpring.dispose()
    unclampedSpring.dispose()
  })

  test('system.running reflects start/stop state', async () => {
    const system = createSpringSystem({ reducedMotion: 'never' })

    expect(system.running).toBe(false)

    system.start()
    expect(system.running).toBe(true)

    await frames(2)
    system.stop()
    expect(system.running).toBe(false)
  })
})
