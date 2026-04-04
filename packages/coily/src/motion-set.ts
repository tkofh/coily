import type { Motion } from './motion.ts'

export class MotionSet {
  readonly #motions = new Set<Motion>()
  readonly #debug: boolean
  #lastSize = 0

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
    for (const motion of this.#motions) {
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
