import { SpringConfig } from './config.ts'
import { Emitter } from './emitter.ts'
import { State } from './state.ts'
import { CriticallyDampedSolver, OverdampedSolver, UnderdampedSolver } from './solver.ts'
import { invariant } from './util.ts'

export class Motion {
  #config: SpringConfig
  readonly #state: State

  #underdampedSolver: UnderdampedSolver | null = null
  #criticallyDampedSolver: CriticallyDampedSolver | null = null
  #overdampedSolver: OverdampedSolver | null = null
  #currentSolver: UnderdampedSolver | CriticallyDampedSolver | OverdampedSolver | null = null

  #needsUpdate = false
  #needsReset = false
  #configVersion = 0
  #globalConfigVersion = 0
  #timeRemaining = 0

  readonly #emitter: Emitter

  constructor(config: SpringConfig, position: number, velocity: number) {
    this.#config = config
    this.#state = new State(config, position, velocity)
    this.#emitter = new Emitter()

    this.#updateSolver()
    this.#timeRemaining = this.#config.computeTimeRemaining(this.#state)
  }

  get position() {
    return this.#state.position
  }


  set position(value: number) {
    this.#state.position = value
    this.#needsReset = true

    if (!this.#state.isResting) {
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

  get timeRemaining() {
    return this.#timeRemaining
  }

  get isResting() {
    return this.#state.isResting
  }

  configure(config: SpringConfig) {
    this.#config = config
    this.#state.configure(config)
    this.#configVersion = SpringConfig.version(config)
    this.#globalConfigVersion = SpringConfig.globalVersion
    this.#needsUpdate = true
  }

  tick(dt: number, emit = true) {
    invariant(this.#currentSolver, 'Cannot tick a disposed motion')

    // Detect config mutations (e.g. from SpringConfig.assign on a shared instance).
    // Two-tier check: only inspect our config's version if any config changed globally.
    const gv = SpringConfig.globalVersion
    if (gv !== this.#globalConfigVersion) {
      this.#globalConfigVersion = gv
      if (SpringConfig.version(this.#config) !== this.#configVersion) {
        this.#state.configure(this.#config)
        this.#configVersion = SpringConfig.version(this.#config)
        this.#needsUpdate = true
      }
    }

    const needsTimeRemaining = this.#needsUpdate || this.#needsReset

    if (this.#needsUpdate) {
      this.#updateSolver()

      this.#needsUpdate = false
      this.#needsReset = false
    } else if (this.#needsReset) {
      this.#currentSolver.configure()

      this.#needsReset = false
    }

    if (needsTimeRemaining) {
      this.#timeRemaining = this.#config.computeTimeRemaining(this.#state)
    }

    this.#currentSolver.tick(dt)
    this.#timeRemaining = Math.max(0, this.#timeRemaining - dt * 1000)

    if (emit) {
      this.#emitter.emit('update')

      if (this.#state.isResting) {
        this.#timeRemaining = 0
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
