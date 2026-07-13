import { SpringDefinition } from './config.ts'
import { Emitter } from './emitter.ts'
import { State } from './state.ts'
import { CriticallyDampedSolver, OverdampedSolver, UnderdampedSolver } from './solver.ts'
import { invariant } from './util.ts'

/**
 * One spring simulation in displacement space: position is measured from
 * the target (0 means settled), so retargeting is a rebase performed by
 * the owning `Spring`. Picks the closed-form solver for the config's
 * damping regime and emits update/start/stop/dispose events.
 */
export class Motion {
  /** Tick-pass marker written by `MotionSet` so a motion re-added mid-pass isn't ticked twice. */
  _pass = 0

  // Set by the owning Spring from its `purpose`; `MotionSet.finishAll`
  // leaves motions that don't respect reduced motion running, so
  // 'appearance' springs keep animating when it turns on.
  respectsReducedMotion = true

  #config: SpringDefinition
  readonly #state: State

  #underdampedSolver: UnderdampedSolver | null = null
  #criticallyDampedSolver: CriticallyDampedSolver | null = null
  #overdampedSolver: OverdampedSolver | null = null
  #currentSolver: UnderdampedSolver | CriticallyDampedSolver | OverdampedSolver | null = null

  // Solver work is deferred to the next tick: #needsUpdate swaps solvers
  // after a reconfigure, #needsReset re-anchors after a position or
  // velocity write.
  #needsUpdate = false
  #needsReset = false
  #timeRemaining = 0
  #running: boolean

  readonly #emitter: Emitter

  constructor(config: SpringDefinition, position: number, velocity: number) {
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

  configure(config: SpringDefinition) {
    this.#config = config
    this.#state.configure(config)
    this.#needsUpdate = true
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

    if (this.#state.isResting) {
      // Snap exactly to the target at rest; the deferred reset re-anchors
      // the solver if the spring is disturbed again.
      this.#state.position = 0
      this.#state.velocity = 0
      this.#needsReset = true
    }

    if (emit) {
      this.#emitter.emit('update')
    }

    if (this.#state.isResting) {
      if (this.#running) {
        this.#running = false
        this.#timeRemaining = 0
        this.#emitter.emit('stop')
      }
    } else if (!this.#running) {
      this.#running = true
      this.#emitter.emit('start')
    }
  }

  finish() {
    this.position = 0
    this.velocity = 0
    this.tick(0)
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

  onDispose(callback: () => void) {
    return this.#emitter.on('dispose', callback)
  }

  dispose() {
    this.#emitter.emit('dispose')
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
