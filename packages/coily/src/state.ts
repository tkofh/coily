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

  get isResting() {
    return (
      Math.abs(this.#position) + Math.abs(this.#velocity) / this.#config.naturalFrequency <=
      this.#config.restingMagnitude
    )
  }
}
