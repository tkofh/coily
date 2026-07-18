import { Motion } from './motion.ts'
import { SpringSourceSymbol, isSpringSource, recipeOf } from './spring-source.ts'

// What advances a registered source: its own motion, or the sources it
// aggregates (a composite's channels), each resolved through its own
// entry. Brand getters write it lazily; `resolveLeaderMotions` reads
// it. A source with no entry is foreign — a user-authored object
// honoring the `SpringSource` contract — and contributes no ordering
// constraint.
const MOTION_BACKING = new WeakMap<object, Motion | readonly object[]>()

/**
 * Records what advances `source`: its own `Motion` for a scalar spring,
 * or the aggregated sources whose own registrations lead to motions (a
 * composite registers its channel springs). Called from the
 * `SpringSourceSymbol` brand getters on every api read — lazily, so
 * springs never used as sources stay out of the weak registry, and
 * idempotently, so repeated reads just overwrite the entry.
 */
export function registerBacking(source: object, backing: Motion | readonly object[]): void {
  MOTION_BACKING.set(source, backing)
}

/**
 * Resolves the motions behind `source`, deduplicated: every spring
 * reached through any chain of derivations — `mapSpring` pipelines,
 * `velocityOf`/`accelerationOf` wrappers, composite channels. A foreign
 * source resolves to nothing: it imposes no tick-ordering constraint and
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
      // slot — a Vue SpringRef exposes its backing spring's — so the
      // wrapper itself never registers; resolve through the api. Coily
      // apis belong to sources created before their wrapper, so the
      // walk still follows creation order and cannot cycle.
      collectInto(api, leaders)
      return
    }
  }
  if (backing === undefined) return
  if (backing instanceof Motion) {
    leaders.add(backing)
  } else {
    for (const part of backing) collectInto(part, leaders)
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
   * self-follow included. Written by `FollowGraph` on recompute. Routes
   * `plan` to the ZOH sub-step law: FOH destabilizes cycles that are
   * stable under ZOH, so no ramp may ever arm inside an SCC.
   */
  _cyclic: boolean
  /** The follower's target as of the last `plan` call. */
  _prevValue: number
  /** The followed value's frame delta observed by the last `plan` call. */
  _d1: number
  /** The frame delta one older than `_d1`; their difference estimates curvature. */
  _d2: number
  /**
   * Re-anchors the follower to the followed source's current value, with
   * the exact semantics of the leader-update handler (finite guard,
   * reduced-motion jump). `h` is the step the follower is about to
   * advance by, in seconds (the internal tick unit); it is unused until
   * sub-stepping and first-order hold interpret the delta.
   */
  recouple(h: number): void
  /**
   * Refreshes the estimator from the follower's current target and
   * returns this edge's sub-step demand for a frame of `dt` seconds —
   * unclamped; the caller maxes over edges and clamps. Runs no user
   * code: history is the target trail, freshness reads leader motion
   * state. Call at most once per edge per frame, before any motion
   * advances.
   */
  plan(dt: number): number
}

/**
 * The follow graph as a walkable structure: one edge per following
 * motion, and a cached dependency rank over every motion the edges
 * touch. `MotionSet` owns one; springs register and unregister edges as
 * follows are wired and torn down. What the tick reads per motion —
 * `_edge`, `_followers`, `_rank` — lives on the motions themselves;
 * this class is their writer.
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

  /** Whether no edges are registered, letting the tick skip ordering work entirely. */
  get isEmpty(): boolean {
    return this.#edges.size === 0
  }

  /** Every registered edge, valid after `ensureOrder`; the plan pass walks this once per frame. */
  get edges(): readonly FollowEdge[] {
    return this.#edgeList
  }

  /**
   * Registers `edge`, replacing any edge with the same follower: a
   * spring follows at most one source at a time.
   */
  addEdge(edge: FollowEdge): void {
    this.#edges.set(edge.follower, edge)
    edge.follower._edge = edge
    this.#dirty = true
  }

  /** Drops the edge whose follower is `motion`, if one is registered. */
  removeEdge(follower: Motion): void {
    if (this.#edges.delete(follower)) {
      follower._edge = null
      this.#dirty = true
    }
  }

  /**
   * Recomputes ranks if an edge was added or removed since the last
   * call; clean calls return immediately. Afterward, motions the graph
   * touches hold ranks counting up from 0 with every leader ranked
   * before its followers, members of a cycle rank in ascending creation
   * id, and motions outside the graph hold -1. Ranks are canonical: a
   * function of graph structure and creation order, never of wiring
   * order.
   */
  ensureOrder(): void {
    if (!this.#dirty) return
    this.#dirty = false
    this.#recompute()
  }

  #recompute(): void {
    for (const motion of this.#ranked) {
      motion._rank = -1
    }

    for (const motion of this.#withFollowers) {
      motion._followers = null
    }
    const withFollowers: Motion[] = []
    for (const edge of this.#edges.values()) {
      for (const leader of edge.leaders) {
        if (leader._followers === null) {
          leader._followers = []
          withFollowers.push(leader)
        }
        leader._followers.push(edge)
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
    const roots = [...nodes].sort((a, b) => a._id - b._id)

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
            // frame.node roots a finished SCC: pop its members and rank
            // them in ascending creation id — the cycle policy, stable
            // across passes and churn.
            const members: Motion[] = []
            let member: Motion
            do {
              member = stack.pop()!
              onStack.delete(member)
              members.push(member)
            } while (member !== frame.node)
            members.sort((a, b) => a._id - b._id)
            for (const motion of members) {
              motion._rank = rank++
              sccOf.set(motion, scc)
              ranked.push(motion)
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
      edge._cyclic = edge.leaders.some((leader) => sccOf.get(leader) === home)
    }
    this.#edgeList = edgeList
  }

  #leadersOf(motion: Motion): readonly Motion[] {
    return this.#edges.get(motion)?.leaders ?? NO_LEADERS
  }
}
