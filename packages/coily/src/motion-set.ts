import type { Motion } from './motion.ts'

export class MotionSet {
  readonly #motions = new Set<Motion>()

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
  }
}
