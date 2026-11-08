import { describe, expect, test } from 'vitest'
import { type SpringDefinition, defineSpring } from '../src/config.ts'
import {
  springFromState,
  springStateAt,
  springToCss,
  springToLinear,
  springToTransition,
  springToWaapi,
} from '../src/css.ts'

/** Parses a `linear()` string into its `{ output, input }` stops for assertions. */
function stops(easing: string): Array<{ output: number; input: number | null }> {
  expect(easing.startsWith('linear(')).toBe(true)
  expect(easing.endsWith(')')).toBe(true)
  return easing
    .slice('linear('.length, -1)
    .split(',')
    .map((raw) => {
      const [output, percent] = raw.trim().split(/\s+/)
      return {
        output: Number(output),
        input: percent === undefined ? null : Number(percent.slice(0, -1)) / 100,
      }
    })
}

const settling = defineSpring({ dampingRatio: 1, duration: 500 })
const bouncy = defineSpring({ bounce: 0.6, duration: 500 })
const undamped = defineSpring({ tension: 200, damping: 0 })

describe('springToLinear', () => {
  test('a damped config returns a settle easing', () => {
    expect(springToLinear(settling).mode).toBe('settle')
  })

  test('the easing starts at 0 and ends at 1', () => {
    const s = stops(springToLinear(settling).easing)
    expect(s[0]!.output).toBe(0)
    expect(s.at(-1)!.output).toBe(1)
  })

  test('input percentages are non-decreasing', () => {
    const inputs = stops(springToLinear(bouncy).easing)
      .map((stop) => stop.input)
      .filter((input): input is number => input !== null)
    for (let i = 1; i < inputs.length; i++) {
      expect(inputs[i]!).toBeGreaterThanOrEqual(inputs[i - 1]!)
    }
  })

  test('duration is computeTimeRemaining at the displacement', () => {
    const displacement = 300
    const { duration } = springToLinear(settling, { displacement })
    expect(duration).toBeCloseTo(
      settling.computeTimeRemaining({ position: displacement, velocity: 0 }),
      6,
    )
  })

  test('a bouncy config overshoots past 1', () => {
    const peak = Math.max(...stops(springToLinear(bouncy).easing).map((stop) => stop.output))
    expect(peak).toBeGreaterThan(1)
  })

  test('a critically damped config never exceeds 1', () => {
    const peak = Math.max(...stops(springToLinear(settling).easing).map((stop) => stop.output))
    expect(peak).toBeLessThanOrEqual(1)
  })

  test('displacement scales the duration but not the endpoints', () => {
    const small = springToLinear(settling, { displacement: 10 })
    const large = springToLinear(settling, { displacement: 1000 })
    expect(large.duration).toBeGreaterThan(small.duration)
    expect(stops(small.easing).at(-1)!.output).toBe(1)
    expect(stops(large.easing).at(-1)!.output).toBe(1)
  })

  test('displacement changes the stops, not only the duration', () => {
    // A larger move takes longer to come within the fixed rest threshold,
    // so the same motion spreads over a longer easing.
    const lively = defineSpring({ tension: 170, damping: 10 })
    const small = springToLinear(lively, { displacement: 1 })
    const large = springToLinear(lively, { displacement: 100 })
    expect(large.duration).toBeGreaterThan(small.duration)
    expect(large.easing).not.toBe(small.easing)
    expect(large.stops).not.toBe(small.stops)
  })

  test('reported error stays within the requested budget', () => {
    const result = springToLinear(bouncy, { maxError: 0.005 })
    expect(result.maxError).toBeLessThanOrEqual(0.005)
  })

  test('a tighter error budget keeps at least as many stops', () => {
    const loose = springToLinear(bouncy, { maxError: 0.02 })
    const tight = springToLinear(bouncy, { maxError: 0.001 })
    expect(tight.stops).toBeGreaterThanOrEqual(loose.stops)
  })
})

describe('springToLinear (undamped loop)', () => {
  test('a pure undamped spring returns a loop easing', () => {
    const result = springToLinear(undamped)
    expect(result.mode).toBe('loop')
    if (result.mode === 'loop') {
      expect(result.direction).toBe('alternate')
      expect(result.iterations).toBe('infinite')
    }
  })

  test('dampingRatio 0 also loops', () => {
    expect(springToLinear(defineSpring({ tension: 200, dampingRatio: 0 })).mode).toBe('loop')
  })

  test('the loop easing is monotonic from 0 to 1', () => {
    const outputs = stops(springToLinear(undamped).easing).map((stop) => stop.output)
    expect(outputs[0]).toBe(0)
    expect(outputs.at(-1)).toBe(1)
    for (let i = 1; i < outputs.length; i++) {
      expect(outputs[i]!).toBeGreaterThanOrEqual(outputs[i - 1]!)
    }
  })

  test('the loop duration is one half period', () => {
    expect(springToLinear(undamped).duration).toBeCloseTo(
      (Math.PI / undamped.naturalFrequency) * 1000,
      6,
    )
  })

  test("arrival 'stop' makes an undamped spring settle instead of loop", () => {
    expect(springToLinear(defineSpring({ tension: 200, damping: 0, arrival: 'stop' })).mode).toBe(
      'settle',
    )
  })
})

describe('springFromState', () => {
  test('returns a settle easing from a moving state', () => {
    expect(springFromState(settling, { position: 100, velocity: -500 }).mode).toBe('settle')
  })

  test('throws on a zero displacement', () => {
    expect(() => springFromState(settling, { position: 0, velocity: 500 })).toThrow()
  })

  test('velocity changes the easing versus starting from rest', () => {
    const rest = springFromState(bouncy, { position: 100, velocity: 0 }).easing
    const moving = springFromState(bouncy, { position: 100, velocity: -800 }).easing
    expect(moving).not.toBe(rest)
  })

  test('the easing still spans 0 to 1', () => {
    const s = stops(springFromState(bouncy, { position: 100, velocity: -800 }).easing)
    expect(s[0]!.output).toBe(0)
    expect(s.at(-1)!.output).toBe(1)
  })
})

describe('springStateAt', () => {
  // Critically damped with wn = 1: x(t) = (1 + t) * exp(-t), v(t) = -t * exp(-t).
  const critical = defineSpring({ tension: 1, damping: 2 })

  test('is the identity at zero elapsed', () => {
    const state = { position: 1, velocity: -2 }
    expect(springStateAt(critical, state, 0)).toEqual(state)
  })

  test('matches the closed-form solution', () => {
    const after = springStateAt(critical, { position: 1, velocity: 0 }, 1000)
    expect(after.position).toBeCloseTo(2 / Math.E, 6)
    expect(after.velocity).toBeCloseTo(-1 / Math.E, 6)
  })

  test('decays a damped state toward the target', () => {
    const after = springStateAt(critical, { position: 1, velocity: 0 }, 4000)
    expect(Math.abs(after.position)).toBeLessThan(1)
  })
})

describe('springToWaapi', () => {
  test('settle: two endpoint keyframes filling forwards', () => {
    const { keyframes, options } = springToWaapi(settling, {
      property: 'translate',
      from: 0,
      to: 300,
      unit: 'px',
    })
    expect(keyframes).toEqual([{ translate: '0px' }, { translate: '300px' }])
    expect(options.fill).toBe('forwards')
    expect(options.iterations).toBeUndefined()
    expect(options.easing).toContain('linear(')
    expect(options.duration).toBeGreaterThan(0)
  })

  test('loop: infinite alternate, keyframes mirror across the target', () => {
    const { keyframes, options } = springToWaapi(undamped, {
      property: 'translate',
      from: 0,
      to: 150,
      unit: 'px',
    })
    // Undamped motion swings between `from` and `2 * to - from`, with the
    // target at the midpoint.
    expect(keyframes).toEqual([{ translate: '0px' }, { translate: '300px' }])
    expect(options.iterations).toBe(Number.POSITIVE_INFINITY)
    expect(options.direction).toBe('alternate')
  })

  test('several specs share one easing and merge into the keyframes', () => {
    const { keyframes } = springToWaapi(settling, [
      { property: 'translate', from: 0, to: 300, unit: 'px' },
      { property: 'opacity', from: 0, to: 1 },
    ])
    expect(keyframes[0]).toEqual({ translate: '0px', opacity: '0' })
    expect(keyframes[1]).toEqual({ translate: '300px', opacity: '1' })
  })

  test('specs on the same property compose (space-joined)', () => {
    const { keyframes } = springToWaapi(settling, [
      { property: 'transform', from: 0, to: 200, format: (v) => `translateX(${v}px)` },
      { property: 'transform', from: 1, to: 2, format: (v) => `scale(${v})` },
    ])
    expect(keyframes[0]).toEqual({ transform: 'translateX(0px) scale(1)' })
    expect(keyframes[1]).toEqual({ transform: 'translateX(200px) scale(2)' })
  })

  test('a velocity routes through the from-state path', () => {
    const rest = springToWaapi(settling, { property: 'x', from: 0, to: 300 })
    const moving = springToWaapi(settling, { property: 'x', from: 0, to: 300, velocity: -600 })
    expect(moving.options.easing).not.toBe(rest.options.easing)
  })

  test('velocity across multiple properties throws', () => {
    expect(() =>
      springToWaapi(settling, [
        { property: 'translate', from: 0, to: 1, velocity: 5 },
        { property: 'opacity', from: 0, to: 1 },
      ]),
    ).toThrow()
  })
})

describe('springToCss', () => {
  test('emits a @keyframes rule and an animation shorthand', () => {
    const { keyframes, animation } = springToCss(
      settling,
      { property: 'opacity', from: 0, to: 1 },
      { name: 'fade' },
    )
    expect(keyframes).toContain('@keyframes fade {')
    expect(keyframes).toContain('from { opacity: 0; }')
    expect(keyframes).toContain('to { opacity: 1; }')
    expect(animation).toContain('linear(')
    expect(animation).toContain('forwards')
    expect(animation).toContain('fade')
  })

  test('a loop animation runs infinite alternate', () => {
    const { animation } = springToCss(undamped, {
      property: 'translate',
      from: 0,
      to: 100,
      unit: 'px',
    })
    expect(animation).toContain('infinite alternate')
  })

  test('multiple properties merge into one keyframe block', () => {
    const { keyframes } = springToCss(settling, [
      { property: 'translate', from: 0, to: 40, unit: 'px' },
      { property: 'opacity', from: 0, to: 1 },
    ])
    expect(keyframes).toContain('translate: 0px;')
    expect(keyframes).toContain('opacity: 1;')
  })
})

describe('springToTransition', () => {
  test('returns a property/duration/easing shorthand', () => {
    const transition = springToTransition(settling, { property: 'translate', from: 0, to: 200 })
    expect(transition).toMatch(/^translate \d+(\.\d+)?ms linear\(/)
  })

  test('joins several properties with commas', () => {
    const transition = springToTransition(settling, [
      { property: 'translate', from: 0, to: 40 },
      { property: 'opacity', from: 1, to: 0.5 },
    ])
    // One `linear(...)` per property (its own commas are paren-nested).
    expect(transition.match(/linear\(/g)).toHaveLength(2)
    expect(transition).toContain('translate ')
    expect(transition).toContain('opacity ')
  })

  test('throws on an undamped (looping) config', () => {
    expect(() => springToTransition(undamped, { property: 'left', from: 0, to: 100 })).toThrow()
  })

  test('a velocity hands off momentum, reshaping the curve and the duration', () => {
    const rest = springToTransition(settling, { property: 'translate', from: 0, to: 300 })
    const moving = springToTransition(settling, {
      property: 'translate',
      from: 0,
      to: 300,
      velocity: 2000,
    })
    const handoff = springFromState(settling, { position: -300, velocity: 2000 })

    expect(moving).not.toBe(rest)
    expect(moving).toBe(`translate ${Number(handoff.duration.toFixed(1))}ms ${handoff.easing}`)
  })
})

describe('the emitted easing, evaluated on its own', () => {
  // `linear()` as a browser evaluates it, over ascending inputs: stops
  // without a position sit at 0% and 100%, and of two stops at one
  // position the later wins.
  function evaluator(easing: string): (x: number) => number {
    const parsed = stops(easing).map((stop, i, all) => ({
      y: stop.output,
      x: stop.input ?? (i === 0 ? 0 : i === all.length - 1 ? 1 : Number.NaN),
    }))
    let j = 0
    return (x) => {
      while (j < parsed.length - 2 && parsed[j + 1]!.x <= x) j++
      const a = parsed[j]!
      const b = parsed[j + 1]!
      const dx = b.x - a.x
      return dx === 0 ? b.y : a.y + Math.min(1, Math.max(0, (x - a.x) / dx)) * (b.y - a.y)
    }
  }

  // The spring's exact curve from its closed form, read directly at each
  // input rather than through the sampler, landing on the target at 100%.
  function worstError(
    config: SpringDefinition,
    result: { easing: string; duration: number },
    state: { position: number; velocity: number },
    scale: number,
  ): number {
    const N = 20_000
    const evaluate = evaluator(result.easing)
    let worst = 0
    for (let i = 0; i <= N; i++) {
      const x = i / N
      const exact =
        i === N && scale === 1
          ? 1
          : (1 - springStateAt(config, state, x * result.duration).position / state.position) *
            scale
      worst = Math.max(worst, Math.abs(evaluate(x) - exact))
    }
    return worst
  }

  interface Case {
    config: SpringDefinition
    state?: { position: number; velocity: number }
    maxError?: number
    loop?: boolean
  }
  const critical = defineSpring({ duration: 0.1, dampingRatio: 1 })
  const cases: Record<string, Case> = {
    'a tight budget on an undamped loop': { config: undamped, maxError: 1e-7, loop: true },
    'a 0.1 ms critically damped config': { config: critical },
    'the default budget on a bouncy config': { config: bouncy },
    'a tight budget on a bouncy config': { config: bouncy, maxError: 1e-5 },
    'a mid-flight state with velocity': {
      config: bouncy,
      state: { position: 1, velocity: 40 },
      maxError: 1e-4,
    },
  }

  for (const [label, { config, state, maxError = 0.0025, loop = false }] of Object.entries(cases)) {
    test(`${label} stays within its budget and reports what it emits`, () => {
      const result = state
        ? springFromState(config, state, { maxError })
        : springToLinear(config, { maxError })
      expect(result.mode).toBe(loop ? 'loop' : 'settle')
      const measured = worstError(
        config,
        result,
        state ?? { position: 1, velocity: 0 },
        loop ? 0.5 : 1,
      )
      expect(result.maxError).toBeLessThanOrEqual(maxError)
      expect(measured).toBeLessThanOrEqual(maxError)
      // The diagnostic is the measured error, up to what lies between its
      // own samples.
      expect(measured).toBeLessThanOrEqual(result.maxError * 1.05)
    })
  }

  test('rejects budgets and inputs that cannot be met', () => {
    expect(() => springToLinear(settling, { maxError: 0 })).toThrow('maxError')
    expect(() => springToLinear(settling, { maxError: Number.NaN })).toThrow('maxError')
    expect(() => springToLinear(settling, { maxDuration: Infinity })).toThrow('maxDuration')
    expect(() => springToLinear(settling, { displacement: 0 })).toThrow('displacement')
    expect(() => springToLinear(settling, { displacement: Infinity })).toThrow('displacement')
  })
})
