import { SpringConfig } from './config.ts'
import { Emitter } from './emitter.ts'
import { State } from './state.ts'
import { CriticallyDampedSolver, OverdampedSolver, UnderdampedSolver } from './solver.ts'
import { invariant } from './util.ts'

export class Motion {
  /** Tick-pass stamp owned by MotionSet — prevents double-ticking a motion re-added mid-pass. */
  _pass = 0

  #config: SpringConfig
  readonly #state: State

  #underdampedSolver: UnderdampedSolver | null = null
  #criticallyDampedSolver: CriticallyDampedSolver | null = null
  #overdampedSolver: OverdampedSolver | null = null
  #currentSolver: UnderdampedSolver | CriticallyDampedSolver | OverdampedSolver | null = null

  #needsUpdate = false
  #needsReset = false
  #timeRemaining = 0
  /** Logical animation state — `start` fires only on the false→true edge, `stop` on true→false. */
  #running: boolean

  readonly #emitter: Emitter

  constructor(config: SpringConfig, position: number, velocity: number) {
    this.#config = config
    this.#state = new State(config, position, velocity)
    this.#emitter = new Emitter()
    this.#running = !this.#state.isResting

    this.#updateSolver()
    this.#timeRemaining = this.#config.computeTimeRemaining(this.#state)
  }

  get position() {
    return this.#state.position
  }

  set position(value: number) {
    this.#state.position = value
    this.#needsReset = true
    this.#syncStart()
  }

  get velocity() {
    return this.#state.velocity
  }

  set velocity(value: number) {
    this.#state.velocity = value
    this.#needsReset = true
    this.#syncStart()
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
    this.#needsUpdate = true
    // A precision change can lift sub-threshold state above the resting threshold
    this.#syncStart()
  }

  tick(dt: number, emit = true) {
    invariant(this.#currentSolver, 'Cannot tick a disposed motion')

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
    }

    // `emit` gates only `update` — start/stop transitions always fire,
    // otherwise a non-emitting tick could swallow one and break alternation.
    if (this.#state.isResting) {
      if (this.#running) {
        this.#running = false
        this.#timeRemaining = 0
        this.#emitter.emit('stop')
      }
    } else if (!this.#running) {
      // A sub-threshold nudge can grow past the resting threshold mid-tick
      this.#running = true
      this.#emitter.emit('start')
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

  #syncStart() {
    if (!this.#running && !this.#state.isResting) {
      this.#running = true
      this.#emitter.emit('start')
    }
    // The inverse transition (a mutation that parks the spring) is left to the
    // next tick, so `stop` always arrives after that tick's `update`.
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
