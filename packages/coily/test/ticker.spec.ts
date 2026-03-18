import { describe, expect, test } from 'vitest'
import { MotionSet } from '../src/motion.ts'
import { Ticker } from '../src/ticker.ts'

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
  })

  describe('fps', () => {
    test('defaults to 60', () => {
      const ticker = new Ticker(new MotionSet())
      expect(ticker.fps).toBe(60)
    })

    test('can be set via constructor', () => {
      const ticker = new Ticker(new MotionSet(), { fps: 30 })
      expect(ticker.fps).toBe(30)
    })

    test('can be changed at runtime', () => {
      const ticker = new Ticker(new MotionSet(), { fps: 60 })
      ticker.fps = 30
      expect(ticker.fps).toBe(30)
    })

    test('deltaRatio reflects fps gap', () => {
      const ticker = new Ticker(new MotionSet(), { fps: 60 })
      ticker.tick()
      // manual tick advances by exactly gap, so ratio should be 1
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
})
