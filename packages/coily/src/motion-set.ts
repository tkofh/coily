import { FlushQueue } from './flush-queue.ts'
import type { Motion } from './motion.ts'

export class MotionSet {
  /** When true, springs snap to their targets instead of animating. */
  reduced = false

  /** End-of-pass scheduling for composite springs' coalesced events. */
  readonly flushes = new FlushQueue()

  readonly #motions = new Set<Motion>()
  readonly #debug: boolean
  #lastSize = 0
  #pass = 0

  constructor(debug = false) {
    this.#debug = debug
  }

  add(motion: Motion) {
    this.#motions.add(motion)
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
