import { Motion } from './motion.ts'
import { recipeOf } from './spring-source.ts'

// What advances a registered source: its own motion, or the sources it
// aggregates (a composite's channels), each resolved through its own
// entry. Constructors write it; `resolveLeaderMotions` reads it. A
// source with no entry is foreign — a user-authored object honoring the
// `SpringSource` contract — and contributes no ordering constraint.
const MOTION_BACKING = new WeakMap<object, Motion | readonly object[]>()

/**
 * Records what advances `source`: its own `Motion` for a scalar spring,
 * or the aggregated sources whose own registrations lead to motions (a
 * composite registers its channel springs). Called once per source, from
 * the `Spring` and `CompositeSpring` constructors.
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
  const backing = MOTION_BACKING.get(source)
  if (backing === undefined) return
  if (backing instanceof Motion) {
    leaders.add(backing)
  } else {
    for (const part of backing) collectInto(part, leaders)
  }
}

const NO_LEADERS: readonly Motion[] = []

/**
 * One follow relationship, as the system sees it: which motion
 * retargets, which motions it reads, and how to re-anchor it. `Spring`
 * registers an edge when a follow is wired to a source with resolvable
 * motions, and unregisters it on unfollow and dispose.
 */
export interface FollowEdge {
  /** The motion that retargets when its leaders advance. */
  readonly follower: Motion
  /** The distinct motions behind the followed source, per `resolveLeaderMotions`. */
  readonly leaders: readonly Motion[]
  /**
   * Re-anchors the follower to the followed source's current value, with
   * the exact semantics of the leader-update handler (finite guard,
   * reduced-motion jump). `h` is the step the follower is about to
   * advance by, in seconds (the internal tick unit); it is unused until
   * sub-stepping and first-order hold interpret the delta.
   */
  recouple(h: number): void
}

const NO_EDGES: readonly FollowEdge[] = []

/**
 * The follow graph as a walkable structure: one edge per following
 * motion, and a cached dependency rank over every motion the edges
 * touch. `MotionSet` owns one; springs register and unregister edges as
 * follows are wired and torn down.
 */
export class FollowGraph {
  readonly #edges = new Map<Motion, FollowEdge>()
  readonly #followers = new Map<Motion, FollowEdge[]>()
  /** Motions holding a rank from the last recompute, so stale ranks reset to -1. */
  #ranked: readonly Motion[] = []
  #dirty = false

  /** Whether no edges are registered, letting the tick skip ordering work entirely. */
  get isEmpty(): boolean {
    return this.#edges.size === 0
  }

  /** The edge whose follower is `motion`, if one is registered. */
  edgeOf(motion: Motion): FollowEdge | undefined {
    return this.#edges.get(motion)
  }

  /**
   * The edges reading `motion` — the tick's wake walk. Rebuilt with the
   * rank cache, so it can lag a mid-pass edge change until the next
   * `ensureOrder`; consumers must tolerate edges already unregistered.
   */
  followersOf(motion: Motion): readonly FollowEdge[] {
    return this.#followers.get(motion) ?? NO_EDGES
  }

  /**
   * Registers `edge`, replacing any edge with the same follower: a
   * spring follows at most one source at a time.
   */
  addEdge(edge: FollowEdge): void {
    this.#edges.set(edge.follower, edge)
    this.#dirty = true
  }

  /** Drops the edge whose follower is `motion`, if one is registered. */
  removeEdge(follower: Motion): void {
    if (this.#edges.delete(follower)) {
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

    this.#followers.clear()
    for (const edge of this.#edges.values()) {
      for (const leader of edge.leaders) {
        const list = this.#followers.get(leader)
        if (list === undefined) {
          this.#followers.set(leader, [edge])
        } else {
          list.push(edge)
        }
      }
    }

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
    let index = 0
    let rank = 0

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
              ranked.push(motion)
            }
          }
        }
      }
    }

    this.#ranked = ranked
  }

  #leadersOf(motion: Motion): readonly Motion[] {
    return this.#edges.get(motion)?.leaders ?? NO_LEADERS
  }
}
