import type { Motion } from './motion.ts'
import { SpringSourceSymbol, isSpringSource, recipeOf } from './spring-source.ts'

// What advances a registered source: its own motion, or the sources it
// aggregates (a composite's channels). A source with no entry, whose api
// leads to none, is foreign: a user-authored `SpringSource`, which adds
// no ordering constraint.
const MOTION_BACKING = new WeakMap<object, Motion | readonly object[]>()

/**
 * Records what advances `source`: its own `Motion` for a spring or a
 * ramp, or the aggregated sources that lead to motions (a composite's
 * channel springs). The `SpringSourceSymbol` brand getters call it on
 * every api read, not at construction, so springs never used as sources
 * stay out of the weak registry. A repeat call overwrites the entry.
 */
export function registerBacking(source: object, backing: Motion | readonly object[]): void {
  MOTION_BACKING.set(source, backing)
}

/**
 * Resolves the deduplicated spring and ramp motions behind `source`,
 * through any chain of `mapSpring` pipelines, `velocityOf`,
 * `accelerationOf`, and `targetOf` wrappers, and composite channels. A
 * foreign source resolves to nothing and couples through its emitter
 * alone, with no tick-ordering constraint.
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
    // Reading the api runs a coily brand getter, which registers the backing.
    const api = source[SpringSourceSymbol]
    backing = MOTION_BACKING.get(source)
    if (
      backing === undefined &&
      typeof api === 'object' &&
      api !== null &&
      (api as unknown) !== source
    ) {
      // A wrapper (a Vue SpringRef) can hand out another source's api as a
      // plain value and never register itself, so resolve through the api.
      // That source predates its wrapper, so the walk still cannot cycle.
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
 * multiples of the last observed frame delta. Tuned empirically in
 * `probes/follower-coupling/s4-freshness.ts`.
 */
export const MANIFOLD_GATE = 4

/**
 * The sub-step controller's history of one followed value: its last
 * observed value, `delta`, and `curvature`.
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

  /** The latest `delta` minus the one before it. 0 while the value moves in a straight line. */
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

  /** Restarts the trail at `value` without recording a change. */
  anchor(value: number): void {
    this.#previous = value
  }
}

/**
 * One follow relationship: the motion that retargets, the motions it
 * reads, how to re-anchor it, and the sub-step controller's per-edge
 * state. `Spring` registers one when it follows a source with resolvable
 * motions, and unregisters it on unfollow and dispose.
 */
export interface FollowEdge {
  /** The motion that retargets when its leaders advance. */
  readonly follower: Motion
  /** The distinct motions behind the followed source, per `resolveLeaderMotions`. */
  readonly leaders: readonly Motion[]
  /**
   * Whether the follower shares a Tarjan SCC with any leader, self-follow
   * included. `FollowGraph` writes it on recompute. A cyclic edge stays on
   * ZOH (zero-order hold) and never arms a slope, because FOH (first-order
   * hold) destabilizes cycles that are stable under ZOH.
   */
  cyclic: boolean
  /** The follower's target as `plan` observes it once per frame. */
  readonly trail: TargetTrail
  /**
   * Re-anchors the follower to the followed source's current value before
   * an advance of `h` seconds (the internal tick unit). A reduced-motion
   * jump rests the follower on the new target and emits nothing. Its
   * `endFrame` delivers the events in the settle sweep. An acyclic edge
   * with passthrough arrival and `h > 0` retargets and arms the follower's
   * slope at the delta over `h`, so the advance integrates against the
   * leader's motion. Every other edge retargets exactly as the
   * leader-update handler does (finite guard, rebase).
   */
  recouple(h: number): void
  /**
   * Refreshes the estimator from the follower's current target and
   * returns the edge's unclamped sub-step demand for a frame of `dt`
   * seconds. The caller clamps the max over edges. Runs no user code:
   * history comes from `trail`, freshness from leader motion state. Call
   * it at most once per edge per frame, before any motion advances.
   */
  plan(dt: number): number
}

/**
 * The follow graph: one edge per following motion, and a cached
 * dependency rank over every motion the edges touch. `MotionSet` owns
 * one. This class writes `edge`, `followers`, and `rank` onto the
 * motions, where the tick reads them.
 */
export class FollowGraph {
  readonly #edges = new Map<Motion, FollowEdge>()
  /** Motions holding a rank from the last recompute, so stale ranks reset to -1. */
  #ranked: readonly Motion[] = []
  /** Motions holding a follower list from the last recompute, so stale lists reset to null. */
  #withFollowers: readonly Motion[] = []
  /** The map's edges as an array for the per-frame plan pass, rebuilt with the ranks. */
  #edgeList: readonly FollowEdge[] = []
  #dirty = false

  /** Whether no edges are registered. The tick then skips all ordering work. */
  get isEmpty(): boolean {
    return this.#edges.size === 0
  }

  /** Every registered edge, current as of the last `ensureOrder`. */
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
   * Recomputes ranks if an edge was added or removed since the last call.
   * Afterward, motions the graph touches rank up from 0, every leader
   * before its followers, and motions outside it hold -1. Cycle members
   * rank in ascending creation id. Ranks depend on graph structure and
   * creation order, never on wiring order.
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
    // wiring the same graph in any order yields the same ranks.
    const roots = [...nodes].sort((a, b) => a.id - b.id)

    // Iterative Tarjan over follower -> leader adjacency. An SCC completes
    // only after every SCC it reads from, so ranks assign as SCCs finish.
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
            // frame.node roots a finished SCC. Its members rank in ascending
            // creation id, which stays stable across passes and churn.
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

    // A cycle edge's recouple reads a value the pass has not refreshed
    // yet, so the controller keeps it on ZOH.
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
