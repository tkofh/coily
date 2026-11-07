import type { SpringDefinition } from './config.ts'

/**
 * The mutable position and velocity that a motion and its solvers share,
 * in displacement space. Position 0 means at the target.
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
   * True when |x| + |v| / wn, the displacement plus what the velocity could
   * still add, is within the config's resting threshold.
   */
  get isResting() {
    return (
      Math.abs(this.#position) + Math.abs(this.#velocity) / this.#config.naturalFrequency <=
      this.#config.restingMagnitude
    )
  }
}
