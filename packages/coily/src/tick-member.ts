import type { FollowEdge } from './follow-graph.ts'

/**
 * Anything `MotionSet` advances and `FollowGraph` ranks: a spring's
 * `Motion` or a ramp's `RampMotion`. Lists the bookkeeping both write
 * onto their members and what the tick and the sub-step controller read
 * from them.
 *
 * Each implementation declares the bookkeeping fields itself, with the
 * initial values given here.
 */
export interface TickMember {
  /** Monotone creation id from `nextTickMemberId` in `motion.ts`: breaks ties wherever members need a deterministic order. */
  readonly _id: number

  /** Tick-pass marker written by `MotionSet` so a member re-added mid-pass isn't ticked twice. Starts at 0. */
  _pass: number

  /**
   * Frame marker written by `MotionSet`: sub-steps share one frame, and
   * the first advance in it queues the member for the settle sweep.
   * Starts at 0.
   */
  _frame: number

  /**
   * Dependency rank written by `FollowGraph`: members the follow graph
   * touches count up from 0, leaders before followers; -1, the initial
   * value, marks a member outside the graph.
   */
  _rank: number

  /**
   * The edge this member follows through, or null. Written by
   * `FollowGraph` on edge add/remove so the tick's hot loop reads a
   * field instead of a map. Only a spring's `Motion` ever follows.
   */
  _edge: FollowEdge | null

  /**
   * The edges reading this member, or null when none. Written by
   * `FollowGraph` with the rank cache, so it can lag a mid-pass edge
   * change until the next recompute; the tick tolerates stale entries.
   */
  _followers: FollowEdge[] | null

  /**
   * Whether `MotionSet.finishAll` finishes this member when reduced motion
   * turns on. False for `'nonmotion'` springs, which keep animating, and
   * for ramps, which the system's ramp registry handles.
   */
  respectsReducedMotion: boolean

  /** Whether the member has stopped moving; `MotionSet` drops it once true. */
  readonly isResting: boolean

  /** The current velocity, in value units per second. */
  readonly velocity: number

  /** Advances by `dt` seconds and emits nothing; events wait for `_settleFrame`. */
  _advance(dt: number): void

  /** Delivers the frame's events after every member has advanced. */
  _settleFrame(): void

  /** Ends the motion at once, for reduced motion. */
  finish(): void

  /**
   * The sub-step controller's shock signal, read by a follower's `plan`
   * with this member as its leader. 0 for a member that cannot be knocked
   * off its course.
   */
  _manifoldDeviation(): number

  /** Acceleration from current state, for `plan`'s kinematic bound on a shock frame. */
  _acceleration(): number

  /**
   * Whether the member's motion changes slope within the next `dt`
   * seconds at a moment it can name in advance, which history-based
   * planning cannot see coming. A follower's `plan` demands the sub-step
   * cap on such a frame.
   */
  _kinksWithin(dt: number): boolean
}
