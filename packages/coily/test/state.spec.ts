import { describe, expect, test } from 'vitest'
import { SpringConfig } from '../src/config.ts'
import { State } from '../src/state.ts'

/** ωₙ = √(tension/mass) = 1, so the resting envelope is simply |x| + |v|. */
function makeConfig(precision: number) {
  return new SpringConfig({ tension: 1, damping: 1, precision })
}

describe('State', () => {
  describe('exact values', () => {
    test('position reads back exactly as written', () => {
      const state = new State(makeConfig(2), 1.23456789, 0)
      expect(state.position).toBe(1.23456789)
    })

    test('velocity reads back exactly as written', () => {
      const state = new State(makeConfig(2), 0, 1.23456789)
      expect(state.velocity).toBe(1.23456789)
    })

    test('precision does not affect reads', () => {
      const state = new State(makeConfig(0), 1.23456789, 0)
      expect(state.position).toBe(1.23456789)
    })
  })

  describe('resting detection (envelope vs. threshold)', () => {
    test('resting when position and velocity are zero', () => {
      const state = new State(makeConfig(2), 0, 0)
      expect(state.isResting).toBe(true)
    })

    test('resting when the envelope is within the threshold', () => {
      const state = new State(makeConfig(2), 0.002, 0.002)
      expect(state.isResting).toBe(true)
    })

    test('resting is symmetric in sign', () => {
      const state = new State(makeConfig(2), -0.002, -0.002)
      expect(state.isResting).toBe(true)
    })

    test('not resting when displacement alone exceeds the threshold', () => {
      const state = new State(makeConfig(2), 0.006, 0)
      expect(state.isResting).toBe(false)
    })

    test('displacement and velocity accumulate: each alone is fine, together they exceed', () => {
      // 0.003 + 0.003/ωₙ = 0.006 > 0.005
      const state = new State(makeConfig(2), 0.003, 0.003)
      expect(state.isResting).toBe(false)
    })

    test('a stiff spring rests with velocity above the raw threshold', () => {
      // ωₙ = 10: v = 0.04 is only worth 0.004 of future travel
      const stiff = new SpringConfig({ tension: 100, damping: 1, precision: 2 })
      const state = new State(stiff, 0, 0.04)
      expect(state.isResting).toBe(true)
    })

    test('a soft spring keeps moving with velocity below the raw threshold', () => {
      // ωₙ = 0.1: v = 0.004 is worth 0.04 of future travel — 8× the threshold
      const soft = new SpringConfig({ tension: 0.01, damping: 1, precision: 2 })
      const state = new State(soft, 0, 0.004)
      expect(state.isResting).toBe(false)
    })
  })

  describe('precision changes', () => {
    test('changing precision moves the resting threshold', () => {
      // Envelope 0.04: above the 0.005 threshold at precision 2,
      // inside the 0.05 threshold at precision 1
      const state = new State(makeConfig(2), 0.04, 0)
      expect(state.isResting).toBe(false)

      state.configure(makeConfig(1))
      expect(state.isResting).toBe(true)
    })
  })
})
