import type { FollowEdge } from './follow-graph.ts'
import type { MotionSet } from './motion-set.ts'

let nextId = 0

/**
 * Something the system advances frame by frame: a spring's `SpringMotion`
 * or a ramp's `RampMotion`. `MotionSet` ticks motions and `FollowGraph`
 * orders them through the members declared here. Owners keep their motion
 * in a private field, so none of this reaches the public api.
 *
 * A tick runs in two phases. Every moving motion first advances silently,
 * so followers recouple against frame-current values. Then each motion
 * that advanced delivers its events in `endFrame`.
 */
export abstract class Motion {
  /**
   * The system's set that advances this motion, fixed at creation. The
   * scheduling fields below belong to it alone: a follower in another
   * system reads this motion through its emitter, never through the
   * follow graph. Distinct from membership, since a resting motion leaves
   * the set but keeps its owner.
   */
  readonly owner: MotionSet

  /**
   * Creation order across every kind of motion. The lower id goes first
   * wherever motions need a deterministic order and nothing else decides.
   */
  readonly id = nextId++

  /**
   * The last ordered pass that advanced the motion, written by
   * `MotionSet`, so a motion queued twice in one pass advances once.
   */
  pass = 0

  /**
   * The last ordered frame that advanced the motion, written by
   * `MotionSet`. Sub-steps share one frame, and the first advance in it
   * queues the motion for `endFrame`.
   */
  frame = 0

  /**
   * Dependency rank, written by `FollowGraph`. Motions in the follow
   * graph count up from 0, leaders before followers. -1 marks a motion
   * outside the graph.
   */
  rank = -1

  /**
   * The edge this motion follows through, or null. `FollowGraph` writes
   * it. Only a spring follows.
   */
  edge: FollowEdge | null = null

  /**
   * The edges that read this motion, or null when none do. `FollowGraph`
   * rebuilds them with the ranks, so they can lag a mid-pass edge change
   * until the next recompute. The tick tolerates stale entries.
   */
  followers: FollowEdge[] | null = null

  constructor(owner: MotionSet) {
    this.owner = owner
  }

  /** Whether the motion has stopped moving. `MotionSet` drops it once true. */
  abstract get isResting(): boolean

  /** The current velocity, in value units per second. */
  abstract get velocity(): number

  /** The current acceleration, in value units per second squared. */
  abstract get acceleration(): number

  /** Advances by `h` seconds and emits nothing. Events wait for `endFrame`. */
  abstract advance(h: number): void

  /** Delivers the frame's events, after every motion has advanced. */
  abstract endFrame(): void

  /**
   * Finishes the lifecycle half of `endFrame` (running state, `start` or
   * `stop`, tick membership) after a listener threw partway through it.
   * Idempotent: the running flag flips before its event fires, so a
   * repeat call after a throwing `stop` listener emits nothing.
   */
  abstract reconcile(): void

  /**
   * Applies a change of the system's reduced-motion setting, which
   * `MotionSet.reduced` already holds. A motion whose purpose is
   * `'nonmotion'` ignores it.
   */
  abstract applyReducedMotion(reduced: boolean): void

  /**
   * How far the motion sits from steady tracking. A follower's `plan`
   * reads it from its leader as the sub-step controller's shock signal.
   * A motion that nothing can knock off its course returns 0.
   */
  abstract manifoldDeviation(): number

  /**
   * Whether the motion's slope changes at a known moment within the next
   * `dt` seconds. Planning from history can't foresee that, so a
   * follower's `plan` demands the sub-step cap on that frame.
   */
  abstract kinksWithin(dt: number): boolean
}
