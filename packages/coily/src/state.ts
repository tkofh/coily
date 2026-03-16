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

  /** Uses raw (unrounded) values so resting detection isn't affected by output quantization. */
  get resting() {
    return (
      Math.abs(this.#velocity) < this.#config.restingMagnitude &&
      Math.abs(this.#position) < this.#config.restingMagnitude
    )
  }
}
