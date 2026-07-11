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
   * A spring rests when its remaining motion is confined within the resting
   * threshold. The decay envelope's effective amplitude `|x| + |v|/ωₙ`
   * measures both state terms in position units — velocity is worth `v/ωₙ`
   * of future travel — so one threshold decides rest for both. This is the
   * same amplitude `computeTimeRemaining` estimates from, which therefore
   * reports 0 exactly when the spring is resting.
   */
  get isResting() {
    return (
      Math.abs(this.#position) + Math.abs(this.#velocity) / this.#config.naturalFrequency <=
      this.#config.restingMagnitude
    )
  }
}
