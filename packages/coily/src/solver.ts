import type { SpringConfig } from './config.ts'
import type { State } from './state.ts'

export class UnderdampedSpringSolver {
  #state: State

  #dampedFrequency = 0
  #decayRate = 0
  #t = 0
  #c1 = 0
  #c2 = 0

  constructor(state: State) {
    this.#state = state
  }

  configure(config?: SpringConfig) {
    if (config) {
      this.#decayRate = config.dampingRatio * config.naturalFrequency
      this.#dampedFrequency = config.naturalFrequency * Math.sqrt(1 - config.dampingRatio ** 2)
    }
    this.#t = 0
    this.#c1 = this.#state.position
    this.#c2 =
      (this.#state.velocity + this.#decayRate * this.#state.position) / this.#dampedFrequency
  }

  tick(dt: number) {
    this.#t += dt

    const sin = Math.sin(this.#dampedFrequency * this.#t)
    const cos = Math.cos(this.#dampedFrequency * this.#t)

    const decay = Math.exp(-this.#decayRate * this.#t)
    const decayVelocity = -this.#decayRate * decay

    const oscillation = this.#c1 * cos + this.#c2 * sin
    const oscillationVelocity =
      -this.#c1 * this.#dampedFrequency * sin + this.#c2 * this.#dampedFrequency * cos

    this.#state.position = decay * oscillation
    this.#state.velocity = decay * oscillationVelocity + decayVelocity * oscillation
  }
}

export class CriticallyDampedSpringSolver {
  #state: State

  #naturalFrequency = 0
  #t = 0
  #c1 = 0
  #c2 = 0

  constructor(state: State) {
    this.#state = state
  }

  configure(config?: SpringConfig) {
    if (config) {
      this.#naturalFrequency = config.naturalFrequency
    }
    this.#t = 0
    this.#c1 = this.#state.position
    this.#c2 = this.#state.velocity + this.#naturalFrequency * this.#state.position
  }

  tick(dt: number) {
    this.#t += dt

    const decay = Math.exp(-this.#naturalFrequency * this.#t)
    const decayVelocity = -this.#naturalFrequency * decay

    const scale = this.#c1 + this.#c2 * this.#t
    const scaleVelocity = this.#c2

    this.#state.position = scale * decay
    this.#state.velocity = scaleVelocity * decay + decayVelocity * scale
  }
}

export class OverdampedSpringSolver {
  #state: State

  #dampedFrequency = 0
  #decayRate = 0
  #t = 0
  #c1 = 0
  #c2 = 0

  constructor(state: State) {
    this.#state = state
  }

  configure(config?: SpringConfig) {
    if (config) {
      this.#decayRate = config.dampingRatio * config.naturalFrequency
      this.#dampedFrequency = config.naturalFrequency * Math.sqrt(config.dampingRatio ** 2 - 1)
    }
    this.#t = 0
    this.#c1 = this.#state.velocity + this.#decayRate * this.#state.position
    this.#c2 = this.#state.position * this.#dampedFrequency
  }

  tick(dt: number) {
    this.#t += dt

    const decay = Math.exp(-this.#decayRate * this.#t)
    const decayVelocity = -this.#decayRate * decay

    const clamped = Math.min(this.#dampedFrequency * this.#t, 300)

    const sinh = Math.sinh(clamped)
    const cosh = Math.cosh(clamped)

    const scale = this.#c1 * sinh + this.#c2 * cosh
    const scaleVelocity =
      this.#c1 * this.#dampedFrequency * cosh + this.#c2 * this.#dampedFrequency * sinh

    this.#state.position = (scale * decay) / this.#dampedFrequency
    this.#state.velocity = (scale * decayVelocity + scaleVelocity * decay) / this.#dampedFrequency
  }
}
