import { describe, expect } from 'vitest'
import { defineSpring } from '../src/config.ts'
import { resolveLeaderMotions } from '../src/follow-graph.ts'
import { accelerationOf, velocityOf } from '../src/kinematic-source.ts'
import type { Motion } from '../src/motion.ts'
import { mapSpring } from '../src/spring-source.ts'
import { makeSource, test } from './helpers.ts'

const config = defineSpring({ mass: 1, tension: 170, damping: 26 })

/** Resolved motions as sorted creation ids, for same-set comparisons. */
function idsOf(motions: readonly Motion[]): number[] {
  return motions.map((motion) => motion._id).sort((a, b) => a - b)
}

describe('resolveLeaderMotions', () => {
  test('a spring resolves to its single motion, stable across calls', ({ system }) => {
    const spring = system.createSpring(0, config)
    const other = system.createSpring(0, config)

    const first = resolveLeaderMotions(spring)
    expect(first).toHaveLength(1)
    expect(resolveLeaderMotions(spring)[0]).toBe(first[0])
    expect(resolveLeaderMotions(other)[0]).not.toBe(first[0])
  })

  test('motion ids are monotone in creation order', ({ system }) => {
    const a = system.createSpring(0, config)
    const b = system.createSpring(0, config)

    expect(resolveLeaderMotions(a)[0]!._id).toBeLessThan(resolveLeaderMotions(b)[0]!._id)
  })

  test('a mapped source resolves to the spring it reads', ({ system }) => {
    const spring = system.createSpring(0, config)
    const mapped = mapSpring(spring, (value) => value * 2)

    const resolved = resolveLeaderMotions(mapped)
    expect(resolved).toHaveLength(1)
    expect(resolved[0]).toBe(resolveLeaderMotions(spring)[0])
  })

  test('composed maps stay anchored to the root spring', ({ system }) => {
    const spring = system.createSpring(0, config)
    const composed = mapSpring(
      mapSpring(spring, (value) => -value),
      (value) => value + 10,
    )

    const resolved = resolveLeaderMotions(composed)
    expect(resolved).toHaveLength(1)
    expect(resolved[0]).toBe(resolveLeaderMotions(spring)[0])
  })

  test('a shape map resolves to every distinct leaf spring', ({ system }) => {
    const x = system.createSpring(0, config)
    const y = system.createSpring(0, config)
    const shaped = mapSpring({ x, y, echo: x }, ({ x, y, echo }) => x + y + echo)

    expect(idsOf(resolveLeaderMotions(shaped))).toEqual(
      idsOf([...resolveLeaderMotions(x), ...resolveLeaderMotions(y)]),
    )
  })

  test('kinematic wrappers resolve through to the spring behind them', ({ system }) => {
    const spring = system.createSpring(0, config)
    const [motion] = resolveLeaderMotions(spring)

    const viaVelocity = resolveLeaderMotions(velocityOf(spring))
    expect(viaVelocity).toHaveLength(1)
    expect(viaVelocity[0]).toBe(motion)
    expect(resolveLeaderMotions(accelerationOf(spring))[0]).toBe(motion)
    expect(resolveLeaderMotions(mapSpring(velocityOf(spring), Math.abs))[0]).toBe(motion)
  })

  test('a composite resolves to one motion per channel', ({ system }) => {
    const point = system.createSpring({ x: 0, y: 0, depth: { z: 0 } }, config)

    const motions = resolveLeaderMotions(point)
    expect(motions).toHaveLength(3)
    expect(new Set(motions).size).toBe(3)
  })

  test('derivations of a composite share its channel motions', ({ system }) => {
    const point = system.createSpring({ x: 0, y: 0 }, config)
    const channels = idsOf(resolveLeaderMotions(point))

    expect(idsOf(resolveLeaderMotions(mapSpring(point, ({ x, y }) => x + y)))).toEqual(channels)
    expect(idsOf(resolveLeaderMotions(velocityOf(point)))).toEqual(channels)
    // Overlapping derivations of one composite deduplicate.
    const overlapped = mapSpring({ a: point, b: velocityOf(point) }, ({ a, b }) => a.x + b.y)
    expect(idsOf(resolveLeaderMotions(overlapped))).toEqual(channels)
  })

  test('a foreign source resolves to nothing', () => {
    const manual = makeSource(5)

    expect(resolveLeaderMotions(manual.source)).toHaveLength(0)
    expect(resolveLeaderMotions(mapSpring(manual.source, (value) => value * 2))).toHaveLength(0)
  })

  test('foreign leaves drop out of a mixed shape; spring leaves remain', ({ system }) => {
    const manual = makeSource(5)
    const spring = system.createSpring(0, config)
    const mixed = mapSpring({ hand: manual.source, spring }, ({ hand, spring }) => hand + spring)

    const resolved = resolveLeaderMotions(mixed)
    expect(resolved).toHaveLength(1)
    expect(resolved[0]).toBe(resolveLeaderMotions(spring)[0])
  })
})
