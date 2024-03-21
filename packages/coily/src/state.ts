import { roundTo } from './util'

export class State {
  #precision: number
  #restingMagnitude: number

  #position: number
  #velocity: number

  constructor(position: number, velocity: number, precision: number) {
    this.#precision = precision
    this.#restingMagnitude = 1 / 10 ** this.#precision

    this.#position = roundTo(position, this.#precision)
    this.#velocity = roundTo(velocity, this.#precision)
  }

  get position() {
    return this.#position
  }

  set position(value: number) {
    this.#position = roundTo(value, this.#precision)
  }

  get velocity() {
    return this.#velocity
  }

  set velocity(value: number) {
    this.#velocity = roundTo(value, this.#precision)
  }

  get precision() {
    return this.#precision
  }

  set precision(value: number) {
    this.#precision = value
    this.#restingMagnitude = 1 / 10 ** this.#precision
    this.#position = roundTo(this.#position, this.#precision)
    this.#velocity = roundTo(this.#velocity, this.#precision)
  }

  get resting() {
    return (
      Math.abs(this.#velocity) < this.#restingMagnitude &&
      Math.abs(this.#position) < this.#restingMagnitude
    )
  }
}
