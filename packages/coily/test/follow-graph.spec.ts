import { describe, expect } from 'vitest'
import { SpringDefinition, defineSpring } from '../src/config.ts'
import { CompositeSpring } from '../src/composite-spring.ts'
import { FollowGraph, resolveLeaderMotions } from '../src/follow-graph.ts'
import { accelerationOf, velocityOf } from '../src/kinematic-source.ts'
import { Motion } from '../src/motion.ts'
import { MotionSet } from '../src/motion-set.ts'
import { Spring } from '../src/spring.ts'
import { mapSpring } from '../src/spring-source.ts'
import { makeSource, test } from './helpers.ts'

const config = defineSpring({ mass: 1, tension: 170, damping: 26 })

/** Resolved motions as sorted creation ids, for same-set comparisons. */
function idsOf(motions: readonly Motion[]): number[] {
  return motions.map((motion) => motion._id).sort((a, b) => a - b)
}

function makeMotion(): Motion {
  return new Motion(SpringDefinition.default, 0, 0)
}

function link(graph: FollowGraph, follower: Motion, ...leaders: Motion[]): void {
  graph.addEdge({ follower, leaders, recouple: () => {} })
}

/** The single motion behind a scalar spring. */
function motionOf(spring: Spring): Motion {
  return resolveLeaderMotions(spring)[0]!
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

describe('FollowGraph: ordering', () => {
  test('a chain ranks leaders before followers, densely from 0', () => {
    const graph = new FollowGraph()
    const a = makeMotion()
    const b = makeMotion()
    const c = makeMotion()
    const lone = makeMotion()
    link(graph, b, a)
    link(graph, c, b)

    graph.ensureOrder()

    expect(a._rank).toBe(0)
    expect(b._rank).toBe(1)
    expect(c._rank).toBe(2)
    expect(lone._rank).toBe(-1)
  })

  test('ranks are canonical: wiring order does not matter', () => {
    const forward = new FollowGraph()
    const backward = new FollowGraph()
    const a = makeMotion()
    const b = makeMotion()
    const c = makeMotion()

    link(forward, b, a)
    link(forward, c, b)
    forward.ensureOrder()
    const ranks = [a._rank, b._rank, c._rank]

    link(backward, c, b)
    link(backward, b, a)
    backward.ensureOrder()

    expect([a._rank, b._rank, c._rank]).toEqual(ranks)
  })

  test('a diamond ranks the shared leader first and the join last', () => {
    const graph = new FollowGraph()
    const x = makeMotion()
    const y = makeMotion()
    const z = makeMotion()
    const w = makeMotion()
    link(graph, y, x)
    link(graph, z, x)
    link(graph, w, y, z)

    graph.ensureOrder()

    expect(x._rank).toBe(0)
    expect(y._rank).toBe(1)
    expect(z._rank).toBe(2)
    expect(w._rank).toBe(3)
  })

  test('a follower created before its leader still ranks after it', () => {
    const graph = new FollowGraph()
    const follower = makeMotion()
    const leader = makeMotion()
    link(graph, follower, leader)

    graph.ensureOrder()

    expect(leader._rank).toBe(0)
    expect(follower._rank).toBe(1)
  })

  test('cycle members rank consecutively in creation order, before their followers', () => {
    const graph = new FollowGraph()
    const a = makeMotion()
    const b = makeMotion()
    const c = makeMotion()
    const tail = makeMotion()
    // Wire the cycle backward: creation order must win, not wiring order.
    link(graph, a, c)
    link(graph, c, b)
    link(graph, b, a)
    link(graph, tail, c)

    graph.ensureOrder()

    expect(a._rank).toBe(0)
    expect(b._rank).toBe(1)
    expect(c._rank).toBe(2)
    expect(tail._rank).toBe(3)
  })

  test('a self-follow ranks without hanging', () => {
    const graph = new FollowGraph()
    const solo = makeMotion()
    link(graph, solo, solo)

    graph.ensureOrder()

    expect(solo._rank).toBe(0)
  })

  test('replacing a follower edge rewires the order and resets stale ranks', () => {
    const graph = new FollowGraph()
    const a = makeMotion()
    const b = makeMotion()
    const c = makeMotion()
    link(graph, b, a)
    graph.ensureOrder()
    expect(a._rank).toBe(0)

    link(graph, b, c)
    graph.ensureOrder()

    expect(a._rank).toBe(-1)
    expect(c._rank).toBe(0)
    expect(b._rank).toBe(1)
  })

  test('removing the last edge returns every motion to rank -1', () => {
    const graph = new FollowGraph()
    const a = makeMotion()
    const b = makeMotion()
    link(graph, b, a)
    graph.ensureOrder()

    graph.removeEdge(b)
    graph.ensureOrder()

    expect(a._rank).toBe(-1)
    expect(b._rank).toBe(-1)
  })

  test('a deep tail-first chain ranks without recursion limits', () => {
    // Tail-first wiring makes the leader walk descend the whole chain in
    // one DFS: the depth that would overflow a recursive Tarjan.
    const graph = new FollowGraph()
    const motions: Motion[] = []
    for (let i = 0; i < 10000; i++) motions.push(makeMotion())
    for (let i = 0; i < 9999; i++) link(graph, motions[i]!, motions[i + 1]!)

    graph.ensureOrder()

    for (let i = 0; i < 10000; i++) {
      expect(motions[i]!._rank).toBe(9999 - i)
    }
  })

  test('a clean graph does not recompute', () => {
    const graph = new FollowGraph()
    const a = makeMotion()
    const b = makeMotion()
    link(graph, b, a)
    graph.ensureOrder()

    // A recompute would overwrite this sentinel; a clean call must not.
    a._rank = 99
    graph.ensureOrder()
    expect(a._rank).toBe(99)

    link(graph, b, a)
    graph.ensureOrder()
    expect(a._rank).toBe(0)
  })
})

describe('FollowGraph: spring wiring', () => {
  test('following registers an edge; the leader ranks first', () => {
    const motions = new MotionSet()
    const leader = new Spring(motions, 0)
    const follower = new Spring(motions, 0)
    follower.target = leader

    motions.graph.ensureOrder()

    expect(motionOf(leader)._rank).toBe(0)
    expect(motionOf(follower)._rank).toBe(1)
  })

  test('retargeting to a number unfollows and drops the edge', () => {
    const motions = new MotionSet()
    const leader = new Spring(motions, 0)
    const follower = new Spring(motions, 0)
    follower.target = leader
    follower.target = 5

    motions.graph.ensureOrder()

    expect(motionOf(leader)._rank).toBe(-1)
    expect(motionOf(follower)._rank).toBe(-1)
  })

  test('switching leaders rewires the edge', () => {
    const motions = new MotionSet()
    const first = new Spring(motions, 0)
    const second = new Spring(motions, 0)
    const follower = new Spring(motions, 0)
    follower.target = first
    follower.target = second

    motions.graph.ensureOrder()

    expect(motionOf(first)._rank).toBe(-1)
    expect(motionOf(second)._rank).toBe(0)
    expect(motionOf(follower)._rank).toBe(1)
  })

  test('disposing the follower drops its edge', () => {
    const motions = new MotionSet()
    const leader = new Spring(motions, 0)
    const follower = new Spring(motions, 0)
    follower.target = leader
    follower.dispose()

    motions.graph.ensureOrder()

    expect(motionOf(leader)._rank).toBe(-1)
  })

  test('disposing the leader detaches followers and drops their edges', () => {
    const motions = new MotionSet()
    const leader = new Spring(motions, 0)
    const follower = new Spring(motions, 0)
    follower.target = leader
    leader.dispose()

    motions.graph.ensureOrder()

    expect(motionOf(follower)._rank).toBe(-1)
  })

  test('a foreign source registers no edge', () => {
    const motions = new MotionSet()
    const manual = makeSource(5)
    const follower = new Spring(motions, 0)
    follower.target = manual.source

    motions.graph.ensureOrder()

    expect(motionOf(follower)._rank).toBe(-1)
  })

  test('a mapped leader orders the spring it reads first', () => {
    const motions = new MotionSet()
    const leader = new Spring(motions, 0)
    const follower = new Spring(motions, 0)
    follower.target = mapSpring(leader, (value) => value + 1)

    motions.graph.ensureOrder()

    expect(motionOf(leader)._rank).toBe(0)
    expect(motionOf(follower)._rank).toBe(1)
  })

  test('shape-mapped leaders all rank before the follower', () => {
    const motions = new MotionSet()
    const x = new Spring(motions, 0)
    const y = new Spring(motions, 0)
    const follower = new Spring(motions, 0)
    follower.target = mapSpring({ x, y }, ({ x, y }) => x + y)

    motions.graph.ensureOrder()

    expect(motionOf(x)._rank).toBeGreaterThanOrEqual(0)
    expect(motionOf(y)._rank).toBeGreaterThanOrEqual(0)
    expect(motionOf(follower)._rank).toBeGreaterThan(motionOf(x)._rank)
    expect(motionOf(follower)._rank).toBeGreaterThan(motionOf(y)._rank)
  })

  test('mutual followers rank in creation order', () => {
    const motions = new MotionSet()
    const a = new Spring(motions, 0)
    const b = new Spring(motions, 0)
    // Wire the later spring first: creation order must win.
    b.target = a
    a.target = b

    motions.graph.ensureOrder()

    expect(motionOf(a)._rank).toBe(0)
    expect(motionOf(b)._rank).toBe(1)
  })

  test('a composite follow orders channel-wise', () => {
    const motions = new MotionSet()
    const leader = new CompositeSpring(motions, { x: 0, y: 0 })
    const follower = new CompositeSpring(motions, { x: 0, y: 0 })
    follower.target = leader

    motions.graph.ensureOrder()

    const leaderMotions = resolveLeaderMotions(leader)
    const followerMotions = resolveLeaderMotions(follower)
    for (let i = 0; i < leaderMotions.length; i++) {
      expect(leaderMotions[i]!._rank).toBeGreaterThanOrEqual(0)
      expect(followerMotions[i]!._rank).toBeGreaterThan(leaderMotions[i]!._rank)
    }
  })

  test('a channel target follows only that channel', () => {
    const motions = new MotionSet()
    const leader = new Spring(motions, 0)
    const composite = new CompositeSpring(motions, { x: 0, y: 0 })
    composite.target = { x: leader }

    motions.graph.ensureOrder()

    const [x, y] = resolveLeaderMotions(composite)
    expect(motionOf(leader)._rank).toBe(0)
    expect(x!._rank).toBe(1)
    expect(y!._rank).toBe(-1)
  })

  test('rest and wake churn leaves ranks untouched', () => {
    const motions = new MotionSet()
    const leader = new Spring(motions, 0)
    const follower = new Spring(motions, 0)
    follower.target = leader
    motions.graph.ensureOrder()

    leader.target = 100
    for (let i = 0; i < 600; i++) motions.tick(1 / 60)

    expect(follower.value).toBeCloseTo(100, 0)
    expect(motionOf(leader)._rank).toBe(0)
    expect(motionOf(follower)._rank).toBe(1)
  })
})
