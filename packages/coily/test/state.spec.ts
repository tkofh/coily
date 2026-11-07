import { describe, expect, test } from 'vitest'
import { SpringDefinition } from '../src/config.ts'
import { State } from '../src/state.ts'

/** wn = sqrt(tension / mass) = 1, so the rest test reads |x| + |v|. */
function makeConfig(precision: number) {
  return new SpringDefinition({ tension: 1, damping: 1, precision })
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
      // 0.003 + 0.003 / wn = 0.006 > 0.005
      const state = new State(makeConfig(2), 0.003, 0.003)
      expect(state.isResting).toBe(false)
    })

    test('a stiff spring rests with velocity above the raw threshold', () => {
      // wn = 10, so v = 0.04 is worth only 0.004 of future travel.
      const stiff = new SpringDefinition({ tension: 100, damping: 1, precision: 2 })
      const state = new State(stiff, 0, 0.04)
      expect(state.isResting).toBe(true)
    })

    test('a soft spring keeps moving with velocity below the raw threshold', () => {
      // wn = 0.1, so v = 0.004 is worth 0.04 of future travel, 8 times the threshold.
      const soft = new SpringDefinition({ tension: 0.01, damping: 1, precision: 2 })
      const state = new State(soft, 0, 0.004)
      expect(state.isResting).toBe(false)
    })
  })

  describe('precision changes', () => {
    test('changing precision moves the resting threshold', () => {
      // The rest amplitude is 0.04. That is above the 0.005 threshold at
      // precision 2 and inside the 0.05 threshold at precision 1.
      const state = new State(makeConfig(2), 0.04, 0)
      expect(state.isResting).toBe(false)

      state.configure(makeConfig(1))
      expect(state.isResting).toBe(true)
    })
  })
})
