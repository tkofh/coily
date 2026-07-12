import { FlushQueue } from './flush-queue.ts'
import type { Motion } from './motion.ts'

/**
 * The set of motions currently moving. Motions leave the set as they
 * rest and re-enter on any write that disturbs them; `onWake` tells the
 * ticker the set became non-empty so it can stop sleeping.
 */
export class MotionSet {
  reduced = false
  onWake: (() => void) | null = null
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
        // A motion that rested out of the set and was re-added by a
        // handler in the same pass (a follower disturbed by its leader's
        // update) reappears later in the Set iteration; the pass marker
        // keeps it from advancing twice.
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
