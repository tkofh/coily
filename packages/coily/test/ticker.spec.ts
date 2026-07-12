import { afterEach, describe, expect, test, vi } from 'vitest'
import { SpringDefinition } from '../src/config.ts'
import { MotionSet } from '../src/motion-set.ts'
import { Motion } from '../src/motion.ts'
import { Ticker } from '../src/ticker.ts'

/**
 * Deterministic stand-in for the browser's frame scheduler: `frame(elapsed)`
 * advances the clock and fires whatever callbacks are pending, mirroring how
 * rAF delivers one timestamp per displayed frame.
 */
class FrameSource {
  now = 0
  requests = 0
  #callbacks = new Map<number, FrameRequestCallback>()
  #nextId = 1

  install() {
    vi.stubGlobal('window', {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        this.requests++
        const id = this.#nextId++
        this.#callbacks.set(id, callback)
        return id
      },
      cancelAnimationFrame: (id: number) => {
        this.#callbacks.delete(id)
      },
    })
    return this
  }

  get pending() {
    return this.#callbacks.size
  }

  frame(elapsed: number) {
    this.now += elapsed
    const pending = [...this.#callbacks.values()]
    this.#callbacks.clear()
    for (const callback of pending) {
      callback(this.now)
    }
  }
}

/** A motion displaced far enough to stay active for the whole test. */
function activeMotion() {
  return new Motion(SpringDefinition.default, 1e6, 0)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Ticker', () => {
  describe('manual tick()', () => {
    test('advances frame count', () => {
      const ticker = new Ticker(new MotionSet())
      expect(ticker.frame).toBe(0)

      ticker.tick()
      expect(ticker.frame).toBe(1)

      ticker.tick()
      expect(ticker.frame).toBe(2)
    })

    test('advances time by gap (1000/fps)', () => {
      const ticker = new Ticker(new MotionSet(), { fps: 60 })
      const gap = 1000 / 60

      ticker.tick()
      expect(ticker.time).toBeCloseTo(gap)
      expect(ticker.delta).toBeCloseTo(gap)
    })

    test('steps the 1000/60 reference gap when uncapped', () => {
      const ticker = new Ticker(new MotionSet())

      ticker.tick()
      expect(ticker.time).toBeCloseTo(1000 / 60)
      expect(ticker.delta).toBeCloseTo(1000 / 60)
    })
  })

  describe('fps', () => {
    test('defaults to 0 (uncapped)', () => {
      const ticker = new Ticker(new MotionSet())
      expect(ticker.fps).toBe(0)
    })

    test('can be set via constructor', () => {
      const ticker = new Ticker(new MotionSet(), { fps: 30 })
      expect(ticker.fps).toBe(30)
    })

    test('accepts an explicit 0 in the constructor', () => {
      const ticker = new Ticker(new MotionSet(), { fps: 0 })
      expect(ticker.fps).toBe(0)
    })

    test('can be changed at runtime', () => {
      const ticker = new Ticker(new MotionSet(), { fps: 60 })
      ticker.fps = 30
      expect(ticker.fps).toBe(30)
    })

    test('assigning 0 removes a cap', () => {
      const ticker = new Ticker(new MotionSet(), { fps: 60 })
      ticker.fps = 0
      expect(ticker.fps).toBe(0)
    })

    test('rejects negative values', () => {
      expect(() => new Ticker(new MotionSet(), { fps: -30 })).toThrow(
        'FPS must be greater than or equal to 0',
      )
      const ticker = new Ticker(new MotionSet())
      expect(() => {
        ticker.fps = -30
      }).toThrow('FPS must be greater than or equal to 0')
    })

    test('deltaRatio reflects fps gap', () => {
      const ticker = new Ticker(new MotionSet(), { fps: 60 })
      ticker.tick()
      // manual tick advances by exactly gap, so ratio should be 1
      expect(ticker.deltaRatio).toBeCloseTo(1)
    })

    test('deltaRatio references 1000/60 when uncapped', () => {
      const ticker = new Ticker(new MotionSet())
      ticker.tick()
      expect(ticker.deltaRatio).toBeCloseTo(1)
    })
  })

  describe('lag clamping', () => {
    test('lagThreshold defaults to 500', () => {
      const ticker = new Ticker(new MotionSet())
      expect(ticker.lagThreshold).toBe(500)
    })

    test('adjustedLag defaults to 33', () => {
      const ticker = new Ticker(new MotionSet())
      expect(ticker.adjustedLag).toBe(33)
    })

    test('setting lagThreshold to 0 sets it to a very large value', () => {
      const ticker = new Ticker(new MotionSet())
      ticker.lagThreshold = 0
      expect(ticker.lagThreshold).toBe(1e8)
    })

    test('adjustedLag is clamped to lagThreshold', () => {
      const ticker = new Ticker(new MotionSet())
      ticker.lagThreshold = 20
      expect(ticker.adjustedLag).toBeLessThanOrEqual(20)
    })

    test('lagThreshold: 0 in constructor sets it to a very large value', () => {
      const ticker = new Ticker(new MotionSet(), { lagThreshold: 0 })
      expect(ticker.lagThreshold).toBe(1e8)
    })
  })

  describe('frame-driven stepping', () => {
    test('uncapped: ticks once per frame with the frame delta', () => {
      const source = new FrameSource().install()
      const motions = new MotionSet()
      motions.add(activeMotion())
      const ticker = new Ticker(motions)

      ticker.start()
      source.frame(8.33) // priming frame

      for (let i = 1; i <= 10; i++) {
        source.frame(8.33)
        expect(ticker.frame).toBe(i)
        expect(ticker.delta).toBeCloseTo(8.33)
      }
      expect(ticker.time).toBeCloseTo(83.3)
    })

    test('first callback anchors the clock without stepping', () => {
      const source = new FrameSource().install()
      const motions = new MotionSet()
      motions.add(activeMotion())
      const ticker = new Ticker(motions)

      source.now = 1000 // rAF timestamps don't start at zero
      ticker.start()
      source.frame(8.33)

      expect(ticker.frame).toBe(0)
      expect(ticker.time).toBe(0)
    })

    test('restarting re-anchors the clock instead of counting stopped time', () => {
      const source = new FrameSource().install()
      const motions = new MotionSet()
      motions.add(activeMotion())
      const ticker = new Ticker(motions)

      ticker.start()
      source.frame(8.33)
      source.frame(8.33)
      ticker.stop()

      source.now += 5000 // time passes while stopped

      ticker.start()
      source.frame(8.33) // priming frame
      source.frame(8.33)

      expect(ticker.frame).toBe(2)
      expect(ticker.time).toBeCloseTo(16.66)
    })

    test('120Hz stream with jitter and fps 60: ticks on exactly every 2nd frame', () => {
      const source = new FrameSource().install()
      const motions = new MotionSet()
      motions.add(activeMotion())
      const ticker = new Ticker(motions, { fps: 60 })

      ticker.start()
      source.frame(8.33) // priming frame

      // The regression this guards: a 16.67ms accumulator grid lands exactly
      // on 2-frame boundaries at 120Hz, so timestamp jitter used to flip the
      // crossing between the 2nd and 3rd frame, interleaving 16.7ms and 25ms
      // steps. Frame pacing must absorb the jitter.
      const jitter = [0.4, -0.2, -0.4, 0.1]
      let sinceTick = 0
      for (let i = 0; i < 96; i++) {
        const elapsed = 8.33 + jitter[i % jitter.length]!
        const before = ticker.frame
        source.frame(elapsed)
        sinceTick += elapsed

        if (i % 2 === 1) {
          expect(ticker.frame).toBe(before + 1)
          expect(ticker.delta).toBeCloseTo(sinceTick)
          sinceTick = 0
        } else {
          expect(ticker.frame).toBe(before)
        }
      }
      expect(ticker.frame).toBe(48)
    })

    test('60Hz stream with fps 60: every frame ticks', () => {
      const source = new FrameSource().install()
      const motions = new MotionSet()
      motions.add(activeMotion())
      const ticker = new Ticker(motions, { fps: 60 })

      ticker.start()
      source.frame(16.67) // priming frame

      for (let i = 1; i <= 20; i++) {
        source.frame(16.67)
        expect(ticker.frame).toBe(i)
        expect(ticker.delta).toBeCloseTo(16.67)
      }
    })

    test('mixed cadence uncapped: deltas sum to wall time', () => {
      const source = new FrameSource().install()
      const motions = new MotionSet()
      motions.add(activeMotion())
      const ticker = new Ticker(motions)

      ticker.start()
      source.frame(8.3) // priming frame

      const cadence = [8.3, 12.5, 16.7]
      let wall = 0
      for (let i = 0; i < 30; i++) {
        const elapsed = cadence[i % cadence.length]!
        source.frame(elapsed)
        wall += elapsed
      }

      expect(ticker.frame).toBe(30)
      expect(ticker.time).toBeCloseTo(wall)
    })

    test('mixed cadence with fps 60: no double ticks, deltas sum to wall time', () => {
      const source = new FrameSource().install()
      const motions = new MotionSet()
      motions.add(activeMotion())
      const ticker = new Ticker(motions, { fps: 60 })

      ticker.start()
      source.frame(8.3) // priming frame

      const cadence = [8.3, 12.5, 16.7]
      const deltas: number[] = []
      let wall = 0
      let lastFrame = 0
      for (let i = 0; i < 60; i++) {
        const elapsed = cadence[i % cadence.length]!
        source.frame(elapsed)
        wall += elapsed
        expect(ticker.frame - lastFrame).toBeLessThanOrEqual(1)
        if (ticker.frame > lastFrame) {
          deltas.push(ticker.delta)
          lastFrame = ticker.frame
        }
      }

      // Every tick spans at least a frame-tolerant gap, and nothing is lost:
      // whatever hasn't ticked yet is at most one gap of residual time.
      for (const delta of deltas) {
        expect(delta).toBeGreaterThan(1000 / 60 - 16.7 / 2)
      }
      const delivered = deltas.reduce((sum, delta) => sum + delta, 0)
      expect(ticker.time).toBeCloseTo(delivered)
      expect(wall - delivered).toBeLessThan(1000 / 60)
    })

    test('lag spike clamps the delta to adjustedLag', () => {
      const source = new FrameSource().install()
      const motions = new MotionSet()
      motions.add(activeMotion())
      const ticker = new Ticker(motions)

      ticker.start()
      source.frame(8.33) // priming frame
      source.frame(8.33)

      source.frame(600)
      expect(ticker.delta).toBe(33)
    })

    test('removing the cap at runtime takes effect on the next frame', () => {
      const source = new FrameSource().install()
      const motions = new MotionSet()
      motions.add(activeMotion())
      const ticker = new Ticker(motions, { fps: 30 })

      ticker.start()
      source.frame(8.33) // priming frame

      source.frame(8.33)
      expect(ticker.frame).toBe(0) // paced out by the 33.3ms gap

      ticker.fps = 0
      source.frame(8.33)
      expect(ticker.frame).toBe(1)
      // Paced-out time is delivered, not dropped
      expect(ticker.delta).toBeCloseTo(16.66)
    })
  })

  describe('idle sleep', () => {
    test('stops requesting frames once every motion rests', () => {
      const source = new FrameSource().install()
      const motions = new MotionSet()
      motions.add(new Motion(SpringDefinition.default, 1, 0))
      const ticker = new Ticker(motions)

      ticker.start()
      let guard = 0
      while (motions.size > 0 && guard++ < 10_000) {
        source.frame(8.33)
      }

      expect(motions.size).toBe(0)
      expect(source.pending).toBe(0)
      expect(ticker.stopped).toBe(false) // still logically running

      const requestsAtSleep = source.requests
      source.frame(8.33)
      expect(source.requests).toBe(requestsAtSleep)
    })

    test('starting with an empty set sleeps immediately', () => {
      const source = new FrameSource().install()
      const ticker = new Ticker(new MotionSet())

      ticker.start()
      expect(source.requests).toBe(0)
      expect(ticker.stopped).toBe(false)
    })

    test('adding a motion wakes the loop without manufacturing a delta', () => {
      const source = new FrameSource().install()
      const motions = new MotionSet()
      const ticker = new Ticker(motions)

      ticker.start()
      expect(source.pending).toBe(0) // asleep

      source.now += 30_000 // a long idle stretch

      motions.add(activeMotion())
      expect(source.pending).toBe(1)

      source.frame(8.33) // priming frame — idle time must not become a step
      expect(ticker.time).toBe(0)

      source.frame(8.33)
      expect(ticker.frame).toBe(1)
      expect(ticker.delta).toBeCloseTo(8.33)
    })

    test('waking while stopped stays stopped', () => {
      const source = new FrameSource().install()
      const motions = new MotionSet()
      const ticker = new Ticker(motions)

      motions.add(activeMotion())
      expect(source.pending).toBe(0)

      ticker.start()
      expect(source.pending).toBe(1)
    })

    test('stop() while sleeping is safe and start() re-sleeps', () => {
      const source = new FrameSource().install()
      const motions = new MotionSet()
      const ticker = new Ticker(motions)

      ticker.start()
      ticker.stop()
      expect(ticker.stopped).toBe(true)

      ticker.start()
      expect(source.pending).toBe(0)

      motions.add(activeMotion())
      expect(source.pending).toBe(1)
    })
  })
})
