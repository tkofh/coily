import { FlushQueue } from './flush-queue.ts'
import { type FollowEdge, FollowGraph } from './follow-graph.ts'
import type { Motion } from './motion.ts'

function compareMotions(a: Motion, b: Motion): number {
  return a.rank - b.rank || a.id - b.id
}

// The cap on sub-steps per frame. Past it, one frame's solver work
// competes with the rendering that made the frame long. The s4-freshness
// probe validated it: error stays flat, and the controller reaches the
// cap only on frames that need it.
const MAX_SUBSTEPS = 8

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
 * The set of motions the tick advances. A motion leaves the set when it
 * rests and re-enters on any write that disturbs it. A ramp is in the
 * set only while something watches it frame by frame. `onWake` tells the
 * ticker that the set became non-empty, so a sleeping ticker wakes.
 */
export class MotionSet {
  reduced = false
  onWake: (() => void) | null = null
  /**
   * The coupling error budget, in value units: the local per-frame error
   * the sub-step controller targets on each follow edge, floored by the
   * follower's resting magnitude. `SpringSystem` exposes it as the
   * `couplingTolerance` option and property, and validates it there.
   */
  couplingTolerance = 0.1
  readonly flushes = new FlushQueue()
  /** Follow edges registered by following springs, with the dependency rank over their motions. */
  readonly graph = new FollowGraph()
  /**
   * Motions that a change of reduced motion must reach even while they
   * are out of the tick: a `'motion'` ramp that moves on the clock
   * unwatched, or one that holds still under reduced motion. Each member
   * keeps its own membership current.
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
   * Returns the idle wall time, in seconds, that the clock has not
   * counted yet. Null when no ticker counts idle time. The ticker
   * installs it, and moves the total into the clock with `credit` on the
   * first frame after it starts or wakes, and when it stops.
   */
  idleTime: (() => number) | null = null

  constructor(debug = false) {
    this.#debug = debug
  }

  get size() {
    return this.#motions.size
  }

  /**
   * The system clock in seconds. It moves only forward: by each tick's
   * `dt` when the advance phase ends, and by idle wall time while the
   * ticker sleeps. The ticker reads wall time once per microtask
   * checkpoint, so the clock holds still through synchronous code.
   * Ramps read their position from it.
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
    // A wake during an ordered pass joins the live worklist, so the
    // motion still advances this frame, at its rank position.
    this.#activeHeap?.push(motion)
    if (size === 0) {
      this.onWake?.()
    }
  }

  remove(motion: Motion) {
    this.#motions.delete(motion)
  }

  /**
   * Whether the motion is in the set. The set drops a motion the moment
   * it rests mid-pass, before the motion's own `endFrame`, so a motion
   * asks here instead of tracking its membership itself.
   */
  has(motion: Motion): boolean {
    return this.#motions.has(motion)
  }

  /**
   * Applies a change of the reduced-motion setting to the `reducible`
   * registry, then to every moving motion, leaders before followers. The
   * registry goes first because a ramp's jump retargets its followers.
   * Each motion decides what the change means for it, and a motion
   * reached twice changes once.
   */
  setReduced(reduced: boolean) {
    this.reduced = reduced
    this.flushes.batch(() => {
      // Members leave as they come to rest. Set iteration tolerates the
      // deletes.
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

  /** The fast path when no follow edges exist. Nothing constrains the order, so the loop uses insertion order. */
  #tickUnordered(dt: number, reentrant: boolean) {
    const previous = this.#advancing
    this.#advancing = ++this.#ticks
    const advanced: Motion[] = reentrant ? [] : this.#advanced
    advanced.length = 0
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
    } finally {
      this.#advancing = previous
    }

    this.#clock += dt
    this.#settle(advanced)
  }

  // Advances motions in dependency order, every follower after its
  // leaders by follow-graph rank. A follower then integrates against its
  // leader's value for this frame, whatever order construction and
  // rest/wake churn left the set in. The frame is K sub-steps of dt/K,
  // each its own pass, then one settle sweep. K is the largest demand
  // the plan pass finds over measurable edges, capped at MAX_SUBSTEPS.
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

    // The plan pass refreshes the estimator on every measurable edge and
    // takes the largest demand as the frame's sub-step count. All edges
    // share one subdivision, so every recouple in a sub-step reads a
    // leader of the same age. An edge is measurable when a leader is
    // active, because nothing else moves a followed value between plans.
    // The recouple skip below uses the same test. Under reduced motion
    // recouples jump, so nothing needs refining and the estimators idle.
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

    try {
      for (let step = 0; step < K; step++) {
        this.#advancePass(dt, h, step === 0, heap, advanced, frame)
      }
    } finally {
      // Restored before the sweep, so a motion that a settle callback
      // wakes advances from the next frame, not this one.
      this.#activeHeap = previous
      this.#advancing = previousAdvancing
    }

    // The clock moves before any event fires, so callbacks read it at
    // the frame's end.
    this.#clock += dt
    this.#settle(advanced)
  }

  // One sub-step of an ordered frame: seed from the active set, pop in
  // (rank, id) order, recouple then advance. A motion that advances for
  // the first time this frame joins the settle list, in first-advance
  // order.
  #advancePass(
    dt: number,
    h: number,
    first: boolean,
    heap: MotionHeap,
    advanced: Motion[],
    frame: number,
  ) {
    this.#pass++
    heap.clear()
    for (const motion of this.#motions) {
      // Independents advance once with the whole frame, so later
      // sub-steps skip them at the seed. Splitting dt into K parts is not
      // float-exact, and nothing couples to them within the frame.
      if (!first && motion.rank === -1) continue
      heap.push(motion)
    }

    for (let motion = heap.pop(); motion !== undefined; motion = heap.pop()) {
      if (motion.pass === this.#pass) continue

      // Pull coupling. Events wait for the settle sweep, so this is the
      // only thing that couples followers mid-pass. The tick skips it
      // when every leader is resting and unadvanced: their values cannot
      // have changed since the last retarget, and user map code then
      // stays uncalled on frames where its inputs are still.
      const edge = motion.edge
      if (edge !== null && this.#shouldRecouple(edge)) {
        edge.recouple(h)
      }
      // The wake walk pushes followers whether or not they wake. A
      // popped follower that stayed at rest must skip without the pass
      // mark, so a later wake in this pass can still advance it.
      if (!this.#motions.has(motion)) continue

      motion.pass = this.#pass
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

  // Phase 2 delivers the frame's events in the order the motions
  // advanced, after all of them have, so update callbacks everywhere
  // read the frame's final values. A throwing callback skips the motions
  // after it, like the rest of any aborted pass.
  #settle(advanced: readonly Motion[]) {
    for (const motion of advanced) {
      motion.endFrame()
    }
  }

  #shouldRecouple(edge: FollowEdge): boolean {
    for (const leader of edge.leaders) {
      if (leader.pass === this.#pass || this.#motions.has(leader)) {
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
