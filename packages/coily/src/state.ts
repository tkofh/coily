import type { SpringDefinition } from './config.ts'

/**
 * The mutable position/velocity pair a motion and its solvers share, in
 * displacement space: position 0 means at the target.
 */
export class State {
  #config: SpringDefinition

  #position: number
  #velocity: number

  constructor(config: SpringDefinition, position: number, velocity: number) {
    this.#config = config
    this.#position = position
    this.#velocity = velocity
  }

  configure(config: SpringDefinition) {
    this.#config = config
  }

  get position() {
    return this.#position
  }

  set position(value: number) {
    this.#position = value
  }

  get velocity() {
    return this.#velocity
  }

  set velocity(value: number) {
    this.#velocity = value
  }

  /**
   * The rest test: displacement, plus the displacement the current
   * velocity could still convert into (|x| + |v| / wn), is inside the
   * config's resting threshold.
   */
  get isResting() {
    return (
      Math.abs(this.#position) + Math.abs(this.#velocity) / this.#config.naturalFrequency <=
      this.#config.restingMagnitude
    )
  }
}
