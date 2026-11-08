import { FlushQueue } from './flush-queue.ts'
import { type FollowEdge, FollowGraph } from './follow-graph.ts'
import type { Motion } from './motion.ts'
import { NO_ERROR, invariant, joinErrors } from './util.ts'

function compareMotions(a: Motion, b: Motion): number {
  return a.rank - b.rank || a.id - b.id
}

// The cap on sub-steps per frame. Past it, solver work competes with the
// rendering that made the frame long. The s4-freshness probe shows error
// stays flat and the controller reaches the cap only on frames that need it.
const MAX_SUBSTEPS = 8

// Finishes the lifecycle half of an `endFrame` that threw partway. Out
// of line, with the try block, because recovery code in the settle loop
// costs every frame through V8's inlining budget.
function recover(motion: Motion, error: unknown, caught: unknown): unknown {
  error = joinErrors(error, caught)
  try {
    motion.reconcile()
  } catch (again) {
    error = joinErrors(error, again)
  }
  return error
}

/**
 * The worklist of an ordered pass: a binary min-heap over (rank,
 * creation id). It accepts duplicate pushes, and the tick's pass marker
 * drops the repeats at pop.
 */
class MotionHeap {
  readonly #items: Motion[] = []

  clear(): void {
    this.#items.length = 0
  }

  push(motion: Motion): void {
    const items = this.#items
    let hole = items.length
    items.push(motion)
    while (hole > 0) {
      const parent = (hole - 1) >> 1
      if (compareMotions(items[parent]!, motion) <= 0) break
      items[hole] = items[parent]!
      hole = parent
    }
    items[hole] = motion
  }

  pop(): Motion | undefined {
    const items = this.#items
    if (items.length === 0) return undefined
    const top = items[0]!
    const last = items.pop()!
    if (items.length > 0) {
      let hole = 0
      for (;;) {
        const left = 2 * hole + 1
        if (left >= items.length) break
        const right = left + 1
        const child =
          right < items.length && compareMotions(items[right]!, items[left]!) < 0 ? right : left
        if (compareMotions(last, items[child]!) <= 0) break
        items[hole] = items[child]!
        hole = child
      }
      items[hole] = last
    }
    return top
  }
}

/**
 * The set of motions the tick advances. A motion leaves when it rests and
 * re-enters on any write that disturbs it. A ramp is in the set only
 * while something watches it frame by frame. `onWake` fires when the set
 * becomes non-empty, waking a sleeping ticker.
 */
export class MotionSet {
  reduced = false
  onWake: (() => void) | null = null
  /**
   * The coupling error budget, in value units: the local per-frame error
   * the sub-step controller targets on each follow edge, floored by the
   * follower's resting magnitude. `SpringSystem` validates and exposes it
   * as the `couplingTolerance` option and property.
   */
  couplingTolerance = 0.1
  readonly flushes = new FlushQueue()
  /** Follow edges registered by following springs, with the dependency rank over their motions. */
  readonly graph = new FollowGraph()
  /**
   * Motions a reduced-motion change must reach while out of the tick: a
   * `'motion'` ramp that moves on the clock unwatched, or one holding
   * still under reduced motion. Each member keeps its membership current.
   */
  readonly reducible = new Set<Motion>()
  readonly #motions = new Set<Motion>()
  readonly #heap = new MotionHeap()
  readonly #advanced: Motion[] = []
  /** The live pass worklist while an advance phase runs, so mid-phase wakes join it. */
  #activeHeap: MotionHeap | null = null
  /** Whether any tick is on the stack, settle sweep included. A reentrant advance must not share the pass structures. */
  #inTick = false
  readonly #debug: boolean
  #lastSize = 0
  #pass = 0
  /** Ordered-frame counter. Sub-steps share one id, so a motion joins the settle list once. */
  #frame = 0
  /** Stepped time in seconds: the sum of every tick's `dt`, plus idle time the ticker credits. */
  #clock = 0
  /** Counts ticks, so `advancing` can name the one in its advance phase. */
  #ticks = 0
  #advancing = 0

  /**
   * Returns the idle wall time, in seconds, the clock has not counted yet.
   * Null when no ticker counts idle time. The ticker installs it, and
   * moves the total in with `credit` on its first frame after starting or
   * waking, and when it stops.
   */
  idleTime: (() => number) | null = null

  constructor(debug = false) {
    this.#debug = debug
  }

  get size() {
    return this.#motions.size
  }

  /**
   * The system clock in seconds, which ramps read their position from. It
   * moves only forward: by each tick's `dt` when the advance phase ends,
   * and by idle wall time while the ticker sleeps. Wall time is read once
   * per microtask checkpoint, so the clock holds still through
   * synchronous code.
   */
  get time(): number {
    const idle = this.idleTime
    return idle === null ? this.#clock : this.#clock + idle()
  }

  /**
   * The id of the tick whose advance phase is running, or 0 between
   * phases. A ramp steps a cached value through the sub-steps of the
   * phase and reads its anchor formula everywhere else.
   */
  get advancing(): number {
    return this.#advancing
  }

  /** Adds idle wall time to the clock, in seconds. */
  credit(seconds: number) {
    this.#clock += seconds
  }

  add(motion: Motion) {
    const motions = this.#motions
    const size = motions.size
    motions.add(motion)
    // An active motion is already queued: every pass seeds the worklist
    // with the whole set, and only ranked followers re-add mid-pass.
    if (motions.size === size) return
    // A wake during an ordered pass joins the live worklist and still
    // advances this frame, at its rank position.
    this.#activeHeap?.push(motion)
    if (size === 0) {
      this.onWake?.()
    }
  }

  remove(motion: Motion) {
    this.#motions.delete(motion)
  }

  /**
   * Whether the motion is in the set. A motion that rests mid-pass leaves
   * before its own `endFrame`, so motions ask here rather than track it.
   */
  has(motion: Motion): boolean {
    return this.#motions.has(motion)
  }

  /**
   * Applies a reduced-motion change to the `reducible` registry first,
   * because a ramp's jump retargets its followers, then to every moving
   * motion, leaders before followers. A motion reached twice changes once.
   */
  setReduced(reduced: boolean) {
    this.reduced = reduced
    this.flushes.batch(() => {
      // Members leave as they rest, which Set iteration tolerates.
      for (const motion of this.reducible) {
        motion.applyReducedMotion(reduced)
      }
      // A follower reached before its leader would finish at the stale
      // target, then jump again when the leader finishes.
      this.graph.ensureOrder()
      const motions = [...this.#motions]
      if (!this.graph.isEmpty) motions.sort(compareMotions)
      for (const motion of motions) {
        motion.applyReducedMotion(reduced)
        if (motion.isResting) this.#motions.delete(motion)
      }
    })
  }

  tick(dt: number) {
    // The only user code an advance phase runs is source reads (map code,
    // a custom source's getter). Stepping from there would interleave two
    // phases over one set of pass markers.
    invariant(
      this.#advancing === 0,
      'Cannot advance a SpringSystem while it is advancing; mapSpring callbacks and SpringSource getters must not call advance',
    )
    const reentrant = this.#inTick
    this.#inTick = true
    this.flushes.enter()

    try {
      this.graph.ensureOrder()
      if (this.graph.isEmpty) {
        this.#tickUnordered(dt, reentrant)
      } else {
        this.#tickOrdered(dt, reentrant)
      }
    } finally {
      this.#inTick = reentrant
      this.flushes.exit()
    }

    if (this.#debug && this.#motions.size !== this.#lastSize) {
      this.#lastSize = this.#motions.size
      console.log(`coily: ${this.#lastSize} active motions`)
    }
  }

  /** The fast path with no follow edges. Nothing constrains the order, so insertion order serves. */
  #tickUnordered(dt: number, reentrant: boolean) {
    const previous = this.#advancing
    this.#advancing = ++this.#ticks
    const advanced: Motion[] = reentrant ? [] : this.#advanced
    advanced.length = 0
    let error: unknown = NO_ERROR
    try {
      // Advancing runs no user code, so nothing enters the set mid-loop
      // and each motion advances once.
      for (const motion of this.#motions) {
        motion.advance(dt)
        advanced.push(motion)
        if (motion.isResting) {
          this.#motions.delete(motion)
        }
      }
    } catch (caught) {
      error = caught
    } finally {
      this.#advancing = previous
    }

    if (error === NO_ERROR) this.#clock += dt
    this.#settle(advanced, error)
  }

  // Advances every follower after its leaders by follow-graph rank, so it
  // integrates against its leader's value for this frame whatever order
  // construction and rest/wake churn left the set in. The frame is K
  // sub-steps of dt/K, each its own pass, then one settle sweep.
  #tickOrdered(dt: number, reentrant: boolean) {
    // A reentrant advance (user code stepping the system from inside a
    // callback) gets private worklists so the outer pass's survive.
    const heap = reentrant ? new MotionHeap() : this.#heap
    const advanced: Motion[] = reentrant ? [] : this.#advanced
    const previous = this.#activeHeap
    this.#activeHeap = heap
    const previousAdvancing = this.#advancing
    this.#advancing = ++this.#ticks
    advanced.length = 0
    const frame = ++this.#frame

    // The plan pass refreshes each measurable edge's estimator and takes
    // the largest demand as K, capped at MAX_SUBSTEPS. All edges share one
    // subdivision, so every recouple in a sub-step reads a leader of the
    // same age. An edge is measurable when a leader is active, because
    // nothing else moves a followed value between plans. Under reduced
    // motion recouples jump, so the estimators idle.
    let demand = 1
    if (!this.reduced) {
      for (const edge of this.graph.edges) {
        if (this.#shouldPlan(edge)) {
          const k = edge.plan(dt)
          if (k > demand) demand = k
        }
      }
    }
    const K = Math.min(demand, MAX_SUBSTEPS)
    const h = dt / K

    // A throw from map code aborts the passes, but the motions that
    // advanced still settle, so one that rested leaves no `stop` undelivered.
    let error: unknown = NO_ERROR
    try {
      for (let step = 0; step < K; step++) {
        this.#advancePass(dt, h, step === 0, heap, advanced, frame)
      }
    } catch (caught) {
      error = caught
    } finally {
      // Restored before the sweep, so a motion that a settle callback
      // wakes advances from the next frame, not this one.
      this.#activeHeap = previous
      this.#advancing = previousAdvancing
    }

    // The clock moves before any event fires, so callbacks read it at
    // the frame's end. An aborted frame keeps the old time.
    if (error === NO_ERROR) this.#clock += dt
    this.#settle(advanced, error)
  }

  // One sub-step of an ordered frame: seed from the active set, pop in
  // (rank, id) order, recouple then advance. A motion's first advance this
  // frame adds it to the settle list, in first-advance order.
  #advancePass(
    dt: number,
    h: number,
    first: boolean,
    heap: MotionHeap,
    advanced: Motion[],
    frame: number,
  ) {
    // Captured, not reread: the pass's identity must not depend on what
    // ran since it began.
    const pass = ++this.#pass
    heap.clear()
    for (const motion of this.#motions) {
      // Independents advance once, by the whole dt: nothing couples to
      // them within the frame, and dt split K ways is not float-exact.
      if (!first && motion.rank === -1) continue
      heap.push(motion)
    }

    for (let motion = heap.pop(); motion !== undefined; motion = heap.pop()) {
      if (motion.pass === pass) continue

      // Pull coupling, the only mid-pass coupling, since events wait for
      // the settle sweep. Skipped when every leader is resting and
      // unadvanced: their values cannot have changed since the last
      // retarget, and user map code stays uncalled while its inputs are still.
      const edge = motion.edge
      if (edge !== null && this.#shouldRecouple(edge, pass)) {
        edge.recouple(h)
      }
      // The wake walk pushes followers whether or not they wake. One still
      // at rest skips unmarked, so a later wake this pass can advance it.
      if (!this.#motions.has(motion)) continue

      motion.pass = pass
      motion.advance(motion.rank === -1 ? dt : h)
      if (motion.frame !== frame) {
        motion.frame = frame
        advanced.push(motion)
      }
      if (motion.isResting) {
        this.#motions.delete(motion)
      }
      const followers = motion.followers
      if (followers !== null) {
        for (const out of followers) {
          heap.push(out.follower)
        }
      }
    }
  }

  // Phase 2 delivers events in advance order, after every motion has
  // advanced, so update callbacks read the frame's final values. Every
  // motion settles even after a callback throws, because one that rested
  // has already left the set and no later tick would reach it. The errors
  // rethrow at the end, after any from the advance phase.
  #settle(advanced: readonly Motion[], error: unknown) {
    for (const motion of advanced) {
      try {
        motion.endFrame()
      } catch (caught) {
        error = recover(motion, error, caught)
      }
    }
    if (error !== NO_ERROR) throw error
  }

  #shouldRecouple(edge: FollowEdge, pass: number): boolean {
    for (const leader of edge.leaders) {
      if (leader.pass === pass || this.#motions.has(leader)) {
        return true
      }
    }
    return false
  }

  // Nothing has advanced when the plan pass runs, so unlike the
  // recouple skip this reads activity alone.
  #shouldPlan(edge: FollowEdge): boolean {
    for (const leader of edge.leaders) {
      if (this.#motions.has(leader)) {
        return true
      }
    }
    return false
  }
}
