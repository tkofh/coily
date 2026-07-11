import { FlushQueue } from './flush-queue.ts'
import type { Motion } from './motion.ts'

export class MotionSet {
  /** When true, springs snap to their targets instead of animating. */
  reduced = false

  /**
   * Fired on the empty→non-empty transition, after the motion is in the set.
   * The ticker assigns this so a loop sleeping on an empty set can reschedule.
   */
  onWake: (() => void) | null = null

  /** End-of-pass scheduling for composite springs' coalesced events. */
  readonly flushes = new FlushQueue()

  readonly #motions = new Set<Motion>()
  readonly #debug: boolean
  #lastSize = 0
  #pass = 0

  constructor(debug = false) {
    this.#debug = debug
  }

  get size() {
    return this.#motions.size
  }

  add(motion: Motion) {
    const wasEmpty = this.#motions.size === 0
    this.#motions.add(motion)
    if (wasEmpty) {
      this.onWake?.()
    }
  }

  remove(motion: Motion) {
    this.#motions.delete(motion)
  }

  /** Snap every active motion to rest at its target. */
  finishAll() {
    this.flushes.batch(() => {
      for (const motion of this.#motions) {
        motion.finish()
        this.#motions.delete(motion)
      }
    })
  }

  tick(dt: number) {
    this.#pass++
    this.flushes.enter()

    try {
      for (const motion of this.#motions) {
        // A motion that rested, was removed, and got re-added by a leader's
        // update callback in this same pass has already advanced by dt —
        // ticking it again would double its time this frame.
        if (motion._pass === this.#pass) continue
        motion._pass = this.#pass

        motion.tick(dt)
        if (motion.isResting) {
          this.#motions.delete(motion)
        }
      }
    } finally {
      this.flushes.exit()
    }

    if (this.#debug && this.#motions.size !== this.#lastSize) {
      this.#lastSize = this.#motions.size
      console.log(`coily: ${this.#lastSize} active motions`)
    }
  }
}
