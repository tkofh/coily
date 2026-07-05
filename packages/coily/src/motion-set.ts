import type { Motion } from './motion.ts'

export class MotionSet {
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

  tick(dt: number) {
    this.#pass++

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

    if (this.#debug && this.#motions.size !== this.#lastSize) {
      this.#lastSize = this.#motions.size
      console.log(`coily: ${this.#lastSize} active motions`)
    }
  }
}
