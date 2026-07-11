import type { SpringConfig } from './config.ts'

export class State {
  #config: SpringConfig

  #position: number
  #velocity: number

  constructor(config: SpringConfig, position: number, velocity: number) {
    this.#config = config
    this.#position = position
    this.#velocity = velocity
  }

  configure(config: SpringConfig) {
    this.#config = config
  }

  /** Returns the position rounded to the configured precision. */
  get position() {
    return (
      Math.round(this.#position * this.#config.precisionMultiplier) /
      this.#config.precisionMultiplier
    )
  }

  set position(value: number) {
    this.#position = value
  }

  /**
   * The exact position. Solver anchoring and retarget rebasing read this one:
   * going through the rounded getter there would feed the precision quantum
   * back into state, drifting the trajectory a half-quantum per write.
   */
  get rawPosition() {
    return this.#position
  }

  /** Returns the velocity rounded to the configured precision. */
  get velocity() {
    return (
      Math.round(this.#velocity * this.#config.precisionMultiplier) /
      this.#config.precisionMultiplier
    )
  }

  set velocity(value: number) {
    this.#velocity = value
  }

  /** The exact velocity — see `rawPosition`. */
  get rawVelocity() {
    return this.#velocity
  }

  /** A spring is resting when its rounded position and velocity are both zero. */
  get isResting() {
    return this.position === 0 && this.velocity === 0
  }
}
