import type { FollowEdge } from './follow-graph.ts'

let nextId = 0

/**
 * Something the system advances frame by frame: a spring's
 * `SpringMotion` or a ramp's `RampMotion`. `MotionSet` ticks motions and
 * `FollowGraph` orders them, both through the members declared here.
 * Owners keep their motion in a private field, so none of this reaches
 * the public api.
 *
 * A tick runs in two phases. Every moving motion advances first, with no
 * events, so followers recouple against values that are current for the
 * frame. Then each one that advanced delivers its events in `endFrame`.
 */
export abstract class Motion {
  /**
   * Creation order across every kind of motion. Wherever motions need a
   * deterministic order and nothing else decides it, the lower id goes
   * first.
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
   * Dependency rank, written by `FollowGraph`: motions the follow graph
   * touches count up from 0, leaders before followers, and -1 marks a
   * motion outside the graph.
   */
  rank = -1

  /**
   * The edge this motion follows through, or null. Written by
   * `FollowGraph`; only a spring follows.
   */
  edge: FollowEdge | null = null

  /**
   * The edges reading this motion, or null when none. `FollowGraph`
   * rebuilds them with the ranks, so they can lag a mid-pass edge change
   * until the next recompute. The tick tolerates stale entries.
   */
  followers: FollowEdge[] | null = null

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
   * Applies a change of the system's reduced-motion setting, which
   * `MotionSet.reduced` already holds. A motion whose purpose is
   * `'nonmotion'` ignores it.
   */
  abstract applyReducedMotion(reduced: boolean): void

  /**
   * The sub-step controller's shock signal, read by a follower's `plan`
   * with this motion as its leader: how far the motion sits from steady
   * tracking. 0 for a motion that cannot be knocked off its course.
   */
  abstract manifoldDeviation(): number

  /**
   * Whether the motion's slope changes within the next `dt` seconds at a
   * moment it can name in advance, which history-based planning cannot
   * see coming. A follower's `plan` demands the sub-step cap on such a
   * frame.
   */
  abstract kinksWithin(dt: number): boolean
}
