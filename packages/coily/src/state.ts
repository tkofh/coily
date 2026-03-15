export class State {
  #precision: number
  #precisionMultiplier: number
  #restingMagnitude: number

  #position: number
  #velocity: number

  constructor(position: number, velocity: number, precision: number) {
    this.#precision = precision
    this.#precisionMultiplier = 10 ** precision
    this.#restingMagnitude = 1 / this.#precisionMultiplier

    this.#position = position
    this.#velocity = velocity
  }

  /** Returns the position rounded to the configured precision. */
  get position() {
    return Math.round(this.#position * this.#precisionMultiplier) / this.#precisionMultiplier
  }

  set position(value: number) {
    this.#position = value
  }

  /** Returns the velocity rounded to the configured precision. */
  get velocity() {
    return Math.round(this.#velocity * this.#precisionMultiplier) / this.#precisionMultiplier
  }

  set velocity(value: number) {
    this.#velocity = value
  }

  get precision() {
    return this.#precision
  }

  set precision(value: number) {
    this.#precision = value
    this.#precisionMultiplier = 10 ** value
    this.#restingMagnitude = 1 / this.#precisionMultiplier
  }

  /** Uses raw (unrounded) values so resting detection isn't affected by output quantization. */
  get resting() {
    return (
      Math.abs(this.#velocity) < this.#restingMagnitude &&
      Math.abs(this.#position) < this.#restingMagnitude
    )
  }
}
