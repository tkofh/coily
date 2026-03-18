import { describe, expect, test } from 'vitest'
import { SpringConfig } from '../src/config.ts'
import { State } from '../src/state.ts'

function makeConfig(precision: number) {
  return new SpringConfig({ tension: 1, damping: 1, precision })
}

describe('State', () => {
  describe('output rounding', () => {
    test('rounds position on read', () => {
      const state = new State(makeConfig(2), 1.23456, 0)
      expect(state.position).toBe(1.23)
    })

    test('rounds velocity on read', () => {
      const state = new State(makeConfig(2), 0, 1.23456)
      expect(state.velocity).toBe(1.23)
    })

    test('stores raw value internally (round only on get)', () => {
      const state = new State(makeConfig(3), 0, 0)
      state.position = 1.23456
      expect(state.position).toBe(1.235) // rounded on read

      // Change precision — same raw value, different rounding
      state.configure(makeConfig(2))
      expect(state.position).toBe(1.23)
    })

    test('low precision rounds aggressively', () => {
      const state = new State(makeConfig(1), 1.74, 2.35)
      expect(state.position).toBe(1.7)
      expect(state.velocity).toBe(2.4)
    })

    test('high precision preserves more decimals', () => {
      const state = new State(makeConfig(6), 1.23456789, 0)
      expect(state.position).toBe(1.234568)
    })
  })

  describe('resting detection (uses raw values)', () => {
    test('resting when both position and velocity are below threshold', () => {
      // precision 2 → threshold = 0.01
      const state = new State(makeConfig(2), 0, 0)
      expect(state.isResting).toBe(true)
    })

    test('not resting when position exceeds threshold', () => {
      const state = new State(makeConfig(2), 0.05, 0)
      expect(state.isResting).toBe(false)
    })

    test('not resting when velocity exceeds threshold', () => {
      const state = new State(makeConfig(2), 0, 0.05)
      expect(state.isResting).toBe(false)
    })

    test('resting uses raw values, not rounded values', () => {
      // 0.005 rounds to 0.01 on read, but raw 0.005 IS below threshold 0.01
      const state = new State(makeConfig(2), 0.005, 0.005)
      expect(state.position).toBe(0.01) // rounded output
      expect(state.isResting).toBe(true) // raw check: 0.005 < 0.01
    })

    test('resting threshold changes with precision', () => {
      const state = new State(makeConfig(2), 0.05, 0.05)
      expect(state.isResting).toBe(false) // 0.05 >= 0.01

      state.configure(makeConfig(1))
      // threshold is now 0.1, and raw 0.05 < 0.1
      expect(state.isResting).toBe(true)
    })
  })

  describe('precision changes', () => {
    test('changing precision re-rounds output', () => {
      const state = new State(makeConfig(5), 1.23456, 0)
      expect(state.position).toBe(1.23456)

      state.configure(makeConfig(2))
      expect(state.position).toBe(1.23)
    })

    test('changing precision updates resting threshold', () => {
      const state = new State(makeConfig(2), 0.05, 0.05)
      expect(state.isResting).toBe(false) // raw 0.05 >= threshold 0.01

      // Raising threshold to 0.1 — raw 0.05 < 0.1
      state.configure(makeConfig(1))
      expect(state.isResting).toBe(true)
    })
  })
})
