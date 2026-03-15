import { roundTo } from './util.ts'

export class State {
  #precision: number
  #restingMagnitude: number

  #position: number
  #velocity: number

  constructor(position: number, velocity: number, precision: number) {
    this.#precision = precision
    this.#restingMagnitude = 1 / 10 ** this.#precision

    this.#position = position
    this.#velocity = velocity
  }

  /** Returns the position rounded to the configured precision. */
  get position() {
    return roundTo(this.#position, this.#precision)
  }

  set position(value: number) {
    this.#position = value
  }

  /** Returns the velocity rounded to the configured precision. */
  get velocity() {
    return roundTo(this.#velocity, this.#precision)
  }

  set velocity(value: number) {
    this.#velocity = value
  }

  get precision() {
    return this.#precision
  }

  set precision(value: number) {
    this.#precision = value
    this.#restingMagnitude = 1 / 10 ** this.#precision
  }

  /** Uses raw (unrounded) values so resting detection isn't affected by output quantization. */
  get resting() {
    return (
      Math.abs(this.#velocity) < this.#restingMagnitude &&
      Math.abs(this.#position) < this.#restingMagnitude
    )
  }
}
