import { describe, expect, test } from 'vitest'
import { State } from '../src/state'

describe('State', () => {
  describe('output rounding', () => {
    test('rounds position on read', () => {
      const state = new State(1.23456, 0, 2)
      expect(state.position).toBe(1.23)
    })

    test('rounds velocity on read', () => {
      const state = new State(0, 1.23456, 2)
      expect(state.velocity).toBe(1.23)
    })

    test('stores raw value internally (round only on get)', () => {
      const state = new State(0, 0, 3)
      state.position = 1.23456
      expect(state.position).toBe(1.235) // rounded on read

      // Change precision — same raw value, different rounding
      state.precision = 2
      expect(state.position).toBe(1.23)
    })

    test('precision 0 rounds to integers', () => {
      const state = new State(1.7, 2.3, 0)
      expect(state.position).toBe(2)
      expect(state.velocity).toBe(2)
    })

    test('high precision preserves more decimals', () => {
      const state = new State(1.23456789, 0, 6)
      expect(state.position).toBe(1.234568)
    })
  })

  describe('resting detection (uses raw values)', () => {
    test('resting when both position and velocity are below threshold', () => {
      // precision 2 → threshold = 0.01
      const state = new State(0, 0, 2)
      expect(state.resting).toBe(true)
    })

    test('not resting when position exceeds threshold', () => {
      const state = new State(0.05, 0, 2)
      expect(state.resting).toBe(false)
    })

    test('not resting when velocity exceeds threshold', () => {
      const state = new State(0, 0.05, 2)
      expect(state.resting).toBe(false)
    })

    test('resting uses raw values, not rounded values', () => {
      // 0.005 rounds to 0.01 on read, but raw 0.005 IS below threshold 0.01
      const state = new State(0.005, 0.005, 2)
      expect(state.position).toBe(0.01) // rounded output
      expect(state.resting).toBe(true) // raw check: 0.005 < 0.01
    })

    test('resting threshold changes with precision', () => {
      const state = new State(0.05, 0.05, 2)
      expect(state.resting).toBe(false) // 0.05 >= 0.01

      state.precision = 1
      // threshold is now 0.1, and raw 0.05 < 0.1
      expect(state.resting).toBe(true)
    })
  })

  describe('precision changes', () => {
    test('changing precision re-rounds output', () => {
      const state = new State(1.23456, 0, 5)
      expect(state.position).toBe(1.23456)

      state.precision = 2
      expect(state.position).toBe(1.23)
    })

    test('changing precision updates resting threshold', () => {
      const state = new State(0.05, 0.05, 2)
      expect(state.resting).toBe(false) // raw 0.05 >= threshold 0.01

      // Raising threshold to 0.1 — raw 0.05 < 0.1
      state.precision = 1
      expect(state.resting).toBe(true)
    })
  })
})
