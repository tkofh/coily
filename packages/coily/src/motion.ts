import { type SpringConfig } from './config.ts'
import { Emitter } from './emitter.ts'
import { State } from './state.ts'
import {
  CriticallyDampedSolver,
  OverdampedSolver,
  UnderdampedSolver,
  type Solver,
} from './solver.ts'
import { invariant } from './util.ts'

export class Motion {
  #config: SpringConfig
  readonly #state: State

  #underdampedSolver: UnderdampedSolver | null = null
  #criticallyDampedSolver: CriticallyDampedSolver | null = null
  #overdampedSolver: OverdampedSolver | null = null
  #currentSolver: Solver | null = null

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
    invariant(this.#currentSolver, 'Cannot tick a disposed motion')

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
