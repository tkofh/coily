import { describe, expect } from 'vitest'
import { SpringDefinition, defineSpring } from '../src/config.ts'
import { CompositeSpring } from '../src/composite-spring.ts'
import { type FollowEdge, FollowGraph, resolveLeaderMotions } from '../src/follow-graph.ts'
import { accelerationOf, velocityOf } from '../src/kinematic-source.ts'
import { Motion } from '../src/motion.ts'
import { MotionSet } from '../src/motion-set.ts'
import { Spring } from '../src/spring.ts'
import { SpringSourceSymbol, mapSpring } from '../src/spring-source.ts'
import { makeSource, test } from './helpers.ts'

const config = defineSpring({ mass: 1, tension: 170, damping: 26 })

/** Resolved motions as sorted creation ids, for same-set comparisons. */
function idsOf(motions: readonly Motion[]): number[] {
  return motions.map((motion) => motion._id).sort((a, b) => a - b)
}

function makeMotion(): Motion {
  return new Motion(SpringDefinition.default, 0, 0)
}

function link(graph: FollowGraph, follower: Motion, ...leaders: Motion[]): FollowEdge {
  const edge: FollowEdge = {
    follower,
    leaders,
    _cyclic: false,
    _prevValue: 0,
    _d1: 0,
    _d2: 0,
    recouple: () => {},
    plan: () => 1,
  }
  graph.addEdge(edge)
  return edge
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

  test('a wrapper handing out a spring api resolves through it', ({ system }) => {
    // The Vue SpringRef shape: the brand is a plain value slot holding
    // another source's api, so the wrapper itself never lazily registers.
    const spring = system.createSpring(0, config)
    const wrapper = { [SpringSourceSymbol]: spring[SpringSourceSymbol] }

    const resolved = resolveLeaderMotions(wrapper)
    expect(resolved).toHaveLength(1)
    expect(resolved[0]).toBe(resolveLeaderMotions(spring)[0])
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

describe('FollowGraph: cycle classification', () => {
  test('chain edges are acyclic', () => {
    const graph = new FollowGraph()
    const a = makeMotion()
    const b = makeMotion()
    const c = makeMotion()
    const ab = link(graph, b, a)
    const bc = link(graph, c, b)

    graph.ensureOrder()

    expect(ab._cyclic).toBe(false)
    expect(bc._cyclic).toBe(false)
  })

  test('diamond edges are acyclic', () => {
    const graph = new FollowGraph()
    const x = makeMotion()
    const y = makeMotion()
    const z = makeMotion()
    const w = makeMotion()
    const edges = [link(graph, y, x), link(graph, z, x), link(graph, w, y, z)]

    graph.ensureOrder()

    for (const edge of edges) {
      expect(edge._cyclic).toBe(false)
    }
  })

  test('mutual followers classify both edges cyclic', () => {
    const graph = new FollowGraph()
    const a = makeMotion()
    const b = makeMotion()
    const ab = link(graph, a, b)
    const ba = link(graph, b, a)

    graph.ensureOrder()

    expect(ab._cyclic).toBe(true)
    expect(ba._cyclic).toBe(true)
  })

  test('a self-follow edge is cyclic', () => {
    const graph = new FollowGraph()
    const solo = makeMotion()
    const edge = link(graph, solo, solo)

    graph.ensureOrder()

    expect(edge._cyclic).toBe(true)
  })

  test('a tail off a cycle classifies acyclic while the cycle edges classify', () => {
    const graph = new FollowGraph()
    const a = makeMotion()
    const b = makeMotion()
    const c = makeMotion()
    const tail = makeMotion()
    const cycle = [link(graph, a, c), link(graph, c, b), link(graph, b, a)]
    const out = link(graph, tail, c)

    graph.ensureOrder()

    for (const edge of cycle) {
      expect(edge._cyclic).toBe(true)
    }
    expect(out._cyclic).toBe(false)
  })

  test('breaking a cycle reclassifies the surviving edge', () => {
    const graph = new FollowGraph()
    const a = makeMotion()
    const b = makeMotion()
    link(graph, a, b)
    const ba = link(graph, b, a)
    graph.ensureOrder()
    expect(ba._cyclic).toBe(true)

    graph.removeEdge(a)
    graph.ensureOrder()

    expect(ba._cyclic).toBe(false)
  })

  test('a multi-leader edge is cyclic if any leader shares its SCC', () => {
    const graph = new FollowGraph()
    const outside = makeMotion()
    const a = makeMotion()
    const b = makeMotion()
    const edge = link(graph, b, a, outside)
    link(graph, a, b)

    graph.ensureOrder()

    expect(edge._cyclic).toBe(true)
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

  test('following through a wrapper registers the edge and orders the pair', () => {
    const motions = new MotionSet()
    const leader = new Spring(motions, 0)
    const follower = new Spring(motions, 0)
    follower.target = { [SpringSourceSymbol]: leader[SpringSourceSymbol] }

    motions.graph.ensureOrder()

    expect(motionOf(leader)._rank).toBe(0)
    expect(motionOf(follower)._rank).toBe(1)
  })
})

describe('FollowGraph: planning', () => {
  test("plan tracks the follower's target trail as frame deltas", () => {
    const motions = new MotionSet()
    const leader = new Spring(motions, 0)
    const follower = new Spring(motions, 0)
    follower.target = leader
    const edge = motionOf(follower)._edge!
    expect(edge._prevValue).toBe(follower.target)

    leader.target = 100
    motions.tick(1 / 60)
    // This frame's plan ran before its recouple: the observed delta is
    // still zero, the leader's first move lands in the next plan.
    expect(edge._d1).toBe(0)
    const first = follower.target

    motions.tick(1 / 60)
    expect(edge._d1).toBe(first)
    expect(edge._d2).toBe(0)
    const second = follower.target

    motions.tick(1 / 60)
    expect(edge._d1).toBe(second - first)
    expect(edge._d2).toBe(first)
    expect(edge._prevValue).toBe(second)
  })

  test('an edge with resting leaders is not planned', () => {
    const motions = new MotionSet()
    const leader = new Spring(motions, 0)
    const follower = new Spring(motions, 0)
    follower.target = leader
    const edge = motionOf(follower)._edge!
    // An unplanned edge must not touch its estimator; the sentinel
    // survives frames where only the follower moves.
    edge._prevValue = 42

    follower.value = 50
    motions.tick(1 / 60)
    motions.tick(1 / 60)

    expect(edge._prevValue).toBe(42)
  })

  test('planning reads no user map code', () => {
    const motions = new MotionSet()
    // A huge tolerance pins K = 1, so recouple runs once per frame and
    // any further read could only come from the plan pass.
    motions.couplingTolerance = 1e9
    const leader = new Spring(motions, 0)
    let reads = 0
    const mapped = mapSpring(leader, (value) => {
      reads++
      return value * 2
    })
    const follower = new Spring(motions, 0)
    follower.target = mapped
    const wired = reads

    leader.target = 100
    motions.tick(1 / 60)
    motions.tick(1 / 60)
    motions.tick(1 / 60)

    // Two reads per frame — the mid-pass recouple and the frame-end
    // update handler — and none from the plan pass, whose history is the
    // follower's own target trail.
    expect(reads).toBe(wired + 6)
  })

  test('cycle edges wired through springs classify on the next tick', () => {
    const motions = new MotionSet()
    const a = new Spring(motions, 0)
    const b = new Spring(motions, 0)
    b.target = a
    a.target = b

    motions.graph.ensureOrder()

    expect(motionOf(a)._edge!._cyclic).toBe(true)
    expect(motionOf(b)._edge!._cyclic).toBe(true)
  })
})
