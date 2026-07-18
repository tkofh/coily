import { FlushQueue } from './flush-queue.ts'
import { type FollowEdge, FollowGraph } from './follow-graph.ts'
import type { Motion } from './motion.ts'

function compareMotions(a: Motion, b: Motion): number {
  return a._rank - b._rank || a._id - b._id
}

/**
 * A binary min-heap over (rank, creation id): the ordered pass worklist.
 * Duplicate pushes are expected — the tick's pass marker deduplicates at
 * pop.
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
 * The set of motions currently moving. Motions leave the set as they
 * rest and re-enter on any write that disturbs them; `onWake` tells the
 * ticker the set became non-empty so it can stop sleeping.
 */
export class MotionSet {
  reduced = false
  onWake: (() => void) | null = null
  /**
   * The coupling error budget, in value units: the local per-frame error
   * the sub-step controller targets on each follow edge, floored by the
   * follower's resting magnitude. Internal until the public-option
   * decision in the hybrid plan's stage 3.
   */
  couplingBudget = 0.1
  readonly flushes = new FlushQueue()
  /** Follow edges registered by following springs, with the dependency rank over their motions. */
  readonly graph = new FollowGraph()
  readonly #motions = new Set<Motion>()
  readonly #heap = new MotionHeap()
  readonly #advanced: Motion[] = []
  /** The live pass worklist while an advance phase runs, so mid-phase wakes join it. */
  #activeHeap: MotionHeap | null = null
  /** Whether any tick is on the stack, settle sweep included — a reentrant advance must not share the pass structures. */
  #inTick = false
  readonly #debug: boolean
  #lastSize = 0
  #pass = 0
  /** Ordered-frame counter: sub-steps share one id, deduplicating the settle list. */
  #frame = 0

  constructor(debug = false) {
    this.#debug = debug
  }

  get size() {
    return this.#motions.size
  }

  add(motion: Motion) {
    const wasEmpty = this.#motions.size === 0
    this.#motions.add(motion)
    // A wake during an ordered pass joins the live worklist, so the
    // motion still advances this frame — at its rank position.
    this.#activeHeap?.push(motion)
    if (wasEmpty) {
      this.onWake?.()
    }
  }

  remove(motion: Motion) {
    this.#motions.delete(motion)
  }

  finishAll() {
    this.flushes.batch(() => {
      for (const motion of this.#motions) {
        // 'appearance' motions opt out of reduced motion and keep running.
        if (!motion.respectsReducedMotion) continue
        motion.finish()
        this.#motions.delete(motion)
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

  /** The no-edge fast path: nothing constrains order, so insertion order serves for free. */
  #tickUnordered(dt: number, reentrant: boolean) {
    this.#pass++
    const advanced = reentrant ? [] : this.#advanced
    advanced.length = 0
    for (const motion of this.#motions) {
      // Advancing runs no user code, so nothing enters the set
      // mid-loop; the marker only guards a reentrant advance.
      if (motion._pass === this.#pass) continue
      motion._pass = this.#pass

      motion._advance(dt)
      advanced.push(motion)
      if (motion.isResting) {
        this.#motions.delete(motion)
      }
    }

    this.#settle(advanced)
  }

  // Advances motions in dependency order — every follower after its
  // leaders, ranks from the follow graph — so a follower integrates
  // against its leader's current-frame value no matter how construction
  // order or rest/wake churn arranged the set. The frame is K sub-steps
  // of dt/K (each its own pass) and one settle sweep; the controller's
  // demand is clamped to 1 until the sub-step loop's semantics land
  // (hybrid plan stage 3).
  #tickOrdered(dt: number, reentrant: boolean) {
    // A reentrant advance (user code stepping the system from inside a
    // callback) gets private worklists so the outer pass's survive.
    const heap = reentrant ? new MotionHeap() : this.#heap
    const advanced = reentrant ? [] : this.#advanced
    const previous = this.#activeHeap
    this.#activeHeap = heap
    advanced.length = 0
    const frame = ++this.#frame

    // The plan pass: refresh every measurable edge's estimator and take
    // the frame's sub-step demand as their max. An edge is measurable
    // when a leader is active — nothing else moves a followed value
    // between plans — mirroring the recouple skip below.
    let demand = 1
    for (const edge of this.graph.edges) {
      if (this.#shouldPlan(edge)) {
        const k = edge.plan(dt)
        if (k > demand) demand = k
      }
    }
    const K = Math.min(demand, 1)
    const h = dt / K

    try {
      for (let step = 0; step < K; step++) {
        this.#advancePass(dt, h, step === 0, heap, advanced, frame)
      }
    } finally {
      // Restored before the sweep: a motion woken by a settle callback
      // advances from the next frame, not this one.
      this.#activeHeap = previous
    }

    this.#settle(advanced)
  }

  // One sub-step of an ordered frame: seed from the active set, pop in
  // (rank, id) order, recouple then advance. A motion advancing for the
  // first time this frame joins the settle list, in first-advance order.
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
      // Independents advance once with the whole frame — splitting dt
      // into K parts is not float-exact, and nothing couples to them
      // within it — so later sub-steps skip them at the seed.
      if (!first && motion._rank === -1) continue
      heap.push(motion)
    }

    for (let motion = heap.pop(); motion !== undefined; motion = heap.pop()) {
      if (motion._pass === this.#pass) continue

      // Pull coupling — with events deferred to the settle sweep,
      // this is what couples followers mid-pass. Skipped when every
      // leader is resting and unadvanced: their values cannot have
      // changed since the last retarget, which also keeps user map
      // code uncalled on frames where its inputs are still.
      const edge = motion._edge
      if (edge !== null && this.#shouldRecouple(edge)) {
        edge.recouple(h)
      }
      // The wake walk pushes followers whether or not they wake; a
      // speculative pop that stayed at rest must skip unmarked, so a
      // later wake this pass can still advance it.
      if (!this.#motions.has(motion)) continue

      motion._pass = this.#pass
      motion._advance(motion._rank === -1 ? dt : h)
      if (motion._frame !== frame) {
        motion._frame = frame
        advanced.push(motion)
      }
      if (motion.isResting) {
        this.#motions.delete(motion)
      }
      const followers = motion._followers
      if (followers !== null) {
        for (const out of followers) {
          heap.push(out.follower)
        }
      }
    }
  }

  // Phase 2: deliver the frame's events after every motion has
  // advanced, in the order they advanced — update callbacks read
  // frame-final values everywhere. Skipped for motions after a throwing
  // callback, like the rest of any aborted pass.
  #settle(advanced: readonly Motion[]) {
    for (const motion of advanced) {
      motion._settleFrame()
    }
  }

  #shouldRecouple(edge: FollowEdge): boolean {
    for (const leader of edge.leaders) {
      if (leader._pass === this.#pass || this.#motions.has(leader)) {
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
