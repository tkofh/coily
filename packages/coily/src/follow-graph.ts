import type { Motion } from './motion.ts'
import { SpringSourceSymbol, isSpringSource, recipeOf } from './spring-source.ts'

// What advances a registered source: its own motion, or the sources it
// aggregates (a composite's channels), each resolved through its own
// entry. Brand getters write it lazily, and `resolveLeaderMotions`
// reads it. A source that has no entry, and whose api leads to none, is
// foreign: a user-authored object that honors the `SpringSource`
// contract. It adds no ordering constraint.
const MOTION_BACKING = new WeakMap<object, Motion | readonly object[]>()

/**
 * Records what advances `source`: its own `Motion` for a spring or a
 * ramp, or the aggregated sources whose own registrations lead to
 * motions (a composite registers its channel springs). The
 * `SpringSourceSymbol` brand getters call it on every api read. The
 * call is lazy, so springs never used as sources stay out of the weak
 * registry. It is also idempotent: a repeated read overwrites the entry.
 */
export function registerBacking(source: object, backing: Motion | readonly object[]): void {
  MOTION_BACKING.set(source, backing)
}

/**
 * Resolves the motions behind `source`, deduplicated: every spring or
 * ramp reached through any chain of derivations. A chain can pass
 * through `mapSpring` pipelines, `velocityOf`, `accelerationOf`, and
 * `targetOf` wrappers, and composite channels. A foreign source
 * resolves to nothing. It imposes no tick-ordering constraint and
 * couples through its emitter alone.
 */
export function resolveLeaderMotions(source: object): readonly Motion[] {
  const leaders = new Set<Motion>()
  collectInto(source, leaders)
  return [...leaders]
}

// Recipe roots and backings only reference sources created before their
// owner, so the walk follows creation order and cannot cycle.
function collectInto(source: object, leaders: Set<Motion>): void {
  const recipe = recipeOf(source)
  if (recipe) {
    for (const root of recipe.sources) collectInto(root, leaders)
    return
  }
  let backing = MOTION_BACKING.get(source)
  if (backing === undefined && isSpringSource(source)) {
    // Backing registers lazily, in the brand getter: reading the api
    // registers coily sources and is a plain read on foreign ones.
    const api = source[SpringSourceSymbol]
    backing = MOTION_BACKING.get(source)
    if (
      backing === undefined &&
      typeof api === 'object' &&
      api !== null &&
      (api as unknown) !== source
    ) {
      // A wrapper can hand out another source's api as a plain value
      // slot, as a Vue SpringRef does with its backing spring's api. The
      // wrapper itself never registers, so resolve through the api.
      // Coily apis belong to sources created before their wrapper, so
      // the walk still follows creation order and cannot cycle.
      collectInto(api, leaders)
      return
    }
  }
  if (backing === undefined) return
  if (Array.isArray(backing)) {
    for (const part of backing as readonly object[]) collectInto(part, leaders)
  } else {
    leaders.add(backing as Motion)
  }
}

const NO_LEADERS: readonly Motion[] = []

/**
 * The sub-step controller's shock gate: an edge's fresh kinematic terms
 * engage only when its leader's manifold deviation exceeds this many
 * multiples of the last observed frame delta. Decided empirically in
 * `probes/follower-coupling/s4-freshness.ts`.
 */
export const MANIFOLD_GATE = 4

/**
 * The sub-step controller's history of one followed value: its last
 * observed value, the latest frame-to-frame change, and how much that
 * change differs from the one before. The difference is a curvature
 * estimate: 0 while the value moves in a straight line.
 */
export class TargetTrail {
  #previous: number
  #delta = 0
  #curvature = 0

  constructor(value: number) {
    this.#previous = value
  }

  /** The change between the last two observed values. */
  get delta(): number {
    return this.#delta
  }

  /** The latest `delta` minus the one before it. */
  get curvature(): number {
    return this.#curvature
  }

  /** Records this frame's value and returns the change since the last one. */
  observe(value: number): number {
    const delta = value - this.#previous
    this.#curvature = delta - this.#delta
    this.#delta = delta
    this.#previous = value
    return delta
  }

  /**
   * Restarts the trail at `value` without recording a change, so the
   * next `observe` measures movement from there.
   */
  anchor(value: number): void {
    this.#previous = value
  }
}

/**
 * One follow relationship, as the system sees it: which motion
 * retargets, which motions it reads, how to re-anchor it, and the
 * sub-step controller's per-edge state. `Spring` registers an edge when
 * a follow is wired to a source with resolvable motions, and
 * unregisters it on unfollow and dispose.
 */
export interface FollowEdge {
  /** The motion that retargets when its leaders advance. */
  readonly follower: Motion
  /** The distinct motions behind the followed source, per `resolveLeaderMotions`. */
  readonly leaders: readonly Motion[]
  /**
   * Whether the follower shares a Tarjan SCC with any of its leaders,
   * self-follow included. `FollowGraph` writes it on recompute. A cyclic
   * edge routes `plan` to the ZOH (zero-order hold) sub-step law. FOH
   * (first-order hold) destabilizes cycles that are stable under ZOH,
   * so a slope must never arm inside an SCC.
   */
  cyclic: boolean
  /** The follower's target as `plan` observes it once per frame. */
  readonly trail: TargetTrail
  /**
   * Re-anchors the follower to the followed source's current value.
   * `h` is the step the follower is about to advance by, in seconds
   * (the internal tick unit). A slope can arm only when the edge is
   * acyclic, the follower's arrival is passthrough, `h > 0`, and the
   * retarget is not a reduced-motion jump. Then it retargets and arms
   * the follower's slope with the delta over `h`, so the coming advance
   * integrates against the leader's motion. A reduced-motion jump puts
   * the follower at rest on the new target and emits nothing. Its
   * `endFrame` delivers the events in the settle sweep. Every other
   * edge retargets with the exact semantics of the leader-update
   * handler (finite guard, rebase).
   */
  recouple(h: number): void
  /**
   * Refreshes the estimator from the follower's current target and
   * returns this edge's sub-step demand for a frame of `dt` seconds.
   * The demand is unclamped. The caller takes the max over edges and
   * clamps it. Runs no user code: history comes from the target trail,
   * and freshness reads leader motion state. Call it at most once per
   * edge per frame, before any motion advances.
   */
  plan(dt: number): number
}

/**
 * The follow graph as a walkable structure: one edge per following
 * motion, and a cached dependency rank over every motion the edges
 * touch. `MotionSet` owns one. Springs register an edge when they wire
 * a follow and unregister it when they tear the follow down. The tick
 * reads `edge`, `followers`, and `rank` from the motions themselves,
 * and this class writes them.
 */
export class FollowGraph {
  readonly #edges = new Map<Motion, FollowEdge>()
  /** Motions holding a rank from the last recompute, so stale ranks reset to -1. */
  #ranked: readonly Motion[] = []
  /** Motions holding a follower list from the last recompute, so stale lists reset to null. */
  #withFollowers: readonly Motion[] = []
  /** Edge list mirroring the map, rebuilt with the ranks, so the per-frame plan pass iterates an array. */
  #edgeList: readonly FollowEdge[] = []
  #dirty = false

  /** Whether no edges are registered. The tick then skips all ordering work. */
  get isEmpty(): boolean {
    return this.#edges.size === 0
  }

  /** Every registered edge, valid after `ensureOrder`. The plan pass walks it once per frame. */
  get edges(): readonly FollowEdge[] {
    return this.#edgeList
  }

  /**
   * Registers `edge`, replacing any edge with the same follower: a
   * spring follows at most one source at a time.
   */
  addEdge(edge: FollowEdge): void {
    this.#edges.set(edge.follower, edge)
    edge.follower.edge = edge
    this.#dirty = true
  }

  /** Drops the edge whose follower is `follower`, if one is registered. */
  removeEdge(follower: Motion): void {
    if (this.#edges.delete(follower)) {
      follower.edge = null
      this.#dirty = true
    }
  }

  /**
   * Recomputes ranks if an edge was added or removed since the last
   * call. A clean call returns immediately. Afterward, motions the graph
   * touches hold ranks that count up from 0, with every leader ranked
   * before its followers. Members of a cycle rank in ascending creation
   * id, and motions outside the graph hold -1. Ranks are canonical: they
   * depend on graph structure and creation order, never on wiring
   * order.
   */
  ensureOrder(): void {
    if (!this.#dirty) return
    this.#dirty = false
    this.#recompute()
  }

  #recompute(): void {
    for (const motion of this.#ranked) {
      motion.rank = -1
    }

    for (const motion of this.#withFollowers) {
      motion.followers = null
    }
    const withFollowers: Motion[] = []
    for (const edge of this.#edges.values()) {
      for (const leader of edge.leaders) {
        if (leader.followers === null) {
          leader.followers = []
          withFollowers.push(leader)
        }
        leader.followers.push(edge)
      }
    }
    this.#withFollowers = withFollowers

    const nodes = new Set<Motion>()
    for (const [follower, edge] of this.#edges) {
      nodes.add(follower)
      for (const leader of edge.leaders) {
        nodes.add(leader)
      }
    }
    // Roots visit in ascending creation id, not edge-insertion order, so
    // ranks depend on structure and creation order alone: wiring the
    // same graph in any order yields the same ranks.
    const roots = [...nodes].sort((a, b) => a.id - b.id)

    // Iterative Tarjan over follower -> leader adjacency. An SCC
    // completes only after every SCC it reads from, so completion order
    // is dependency order and ranks assign as SCCs finish.
    const indexOf = new Map<Motion, number>()
    const lowOf = new Map<Motion, number>()
    const onStack = new Set<Motion>()
    const stack: Motion[] = []
    const ranked: Motion[] = []
    const sccOf = new Map<Motion, number>()
    let index = 0
    let rank = 0
    let scc = 0

    for (const root of roots) {
      if (indexOf.has(root)) continue

      const frames = [{ node: root, leaders: this.#leadersOf(root), next: 0 }]
      indexOf.set(root, index)
      lowOf.set(root, index)
      index++
      stack.push(root)
      onStack.add(root)

      while (frames.length > 0) {
        const frame = frames.at(-1)!
        if (frame.next < frame.leaders.length) {
          const leader = frame.leaders[frame.next++]!
          const seen = indexOf.get(leader)
          if (seen === undefined) {
            indexOf.set(leader, index)
            lowOf.set(leader, index)
            index++
            stack.push(leader)
            onStack.add(leader)
            frames.push({ node: leader, leaders: this.#leadersOf(leader), next: 0 })
          } else if (onStack.has(leader)) {
            lowOf.set(frame.node, Math.min(lowOf.get(frame.node)!, seen))
          }
        } else {
          frames.pop()
          const low = lowOf.get(frame.node)!
          const parent = frames.at(-1)
          if (parent !== undefined) {
            lowOf.set(parent.node, Math.min(lowOf.get(parent.node)!, low))
          }
          if (low === indexOf.get(frame.node)!) {
            // frame.node roots a finished SCC. Pop its members and rank
            // them in ascending creation id. That is the cycle policy,
            // and it stays stable across passes and churn.
            const members: Motion[] = []
            let member: Motion
            do {
              member = stack.pop()!
              onStack.delete(member)
              members.push(member)
            } while (member !== frame.node)
            members.sort((a, b) => a.id - b.id)
            for (const member of members) {
              member.rank = rank++
              sccOf.set(member, scc)
              ranked.push(member)
            }
            scc++
          }
        }
      }
    }

    this.#ranked = ranked

    // An edge inside an SCC is a cycle edge: its recouple reads a value
    // the pass has not refreshed yet, and the controller must keep it on
    // the ZOH law.
    const edgeList = [...this.#edges.values()]
    for (const edge of edgeList) {
      const home = sccOf.get(edge.follower)
      edge.cyclic = edge.leaders.some((leader) => sccOf.get(leader) === home)
    }
    this.#edgeList = edgeList
  }

  #leadersOf(motion: Motion): readonly Motion[] {
    return this.#edges.get(motion)?.leaders ?? NO_LEADERS
  }
}
