import { type SpringConfig } from './config.ts'
import { Emitter } from './emitter.ts'
import { State } from './state.ts'
import { invariant } from './util.ts'

export class Solver {
  #config: SpringConfig
  readonly #state: State

  #underdampedSolver: UnderdampedSolver | null = null
  #criticallyDampedSolver: CriticallyDampedSolver | null = null
  #overdampedSolver: OverdampedSolver | null = null
  #currentSolver: Solveable | null = null

  #needsUpdate = false
  #needsReset = false

  readonly #emitter: Emitter

  constructor(config: SpringConfig, position: number, velocity: number) {
    this.#config = config
    this.#state = new State(config, position, velocity)
    this.#emitter = new Emitter()

    this.#updateSolver()
  }

  get position() {
    return this.#state.position
  }

  set position(value: number) {
    this.#state.position = value
    this.#needsReset = true

    if (!this.#state.resting) {
      this.#emitter.emit('start')
    }
  }

  get velocity() {
    return this.#state.velocity
  }

  set velocity(value: number) {
    this.#state.velocity = value
    this.#needsReset = true
  }

  get resting() {
    return this.#state.resting
  }

  configure(config: SpringConfig) {
    this.#config = config
    this.#state.configure(config)
    this.#needsUpdate = true
  }

  tick(dt: number, emit = true) {
    invariant(this.#currentSolver, 'Cannot tick a disposed solver')

    if (this.#needsUpdate) {
      this.#updateSolver()

      this.#needsUpdate = false
      this.#needsReset = false
    } else if (this.#needsReset) {
      this.#currentSolver.configure()

      this.#needsReset = false
    }

    this.#currentSolver.tick(dt)

    if (emit) {
      this.#emitter.emit('update')

      if (this.#state.resting) {
        this.#emitter.emit('stop')
      }
    }
  }

  onUpdate(callback: () => void) {
    return this.#emitter.on('update', callback)
  }

  onStart(callback: () => void) {
    return this.#emitter.on('start', callback)
  }

  onStop(callback: () => void) {
    return this.#emitter.on('stop', callback)
  }

  dispose() {
    this.#emitter.clear()
    this.#underdampedSolver = null
    this.#criticallyDampedSolver = null
    this.#overdampedSolver = null
    this.#currentSolver = null
  }

  #updateSolver() {
    if (this.#config.dampingRatio < 1) {
      this.#underdampedSolver ||= new UnderdampedSolver(this.#state)

      this.#currentSolver = this.#underdampedSolver
    } else if (this.#config.dampingRatio === 1) {
      this.#criticallyDampedSolver ||= new CriticallyDampedSolver(this.#state)

      this.#currentSolver = this.#criticallyDampedSolver
    } else {
      this.#overdampedSolver ||= new OverdampedSolver(this.#state)

      this.#currentSolver = this.#overdampedSolver
    }

    this.#currentSolver.configure(this.#config)
  }
}

interface Solveable {
  configure: (config?: SpringConfig) => void
  tick: (dt: number) => void
}

class UnderdampedSolver implements Solveable {
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

class CriticallyDampedSolver implements Solveable {
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

class OverdampedSolver implements Solveable {
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
