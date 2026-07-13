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
})
