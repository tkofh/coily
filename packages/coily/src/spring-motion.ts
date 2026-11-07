import { SpringDefinition } from './config.ts'
import { Emitter } from './emitter.ts'
import { Motion } from './motion.ts'
import { State } from './state.ts'
import { CriticallyDampedSolver, OverdampedSolver, UnderdampedSolver } from './solver.ts'
import type { Purpose } from './spring.ts'
import { invariant } from './util.ts'

/**
 * One spring simulation in displacement space. Position is measured from
 * the target (0 means settled), so a retarget is a rebase that the
 * owning `Spring` performs. Picks the closed-form solver for the
 * config's damping regime and emits update, start, stop, and dispose
 * events.
 */
export class SpringMotion extends Motion {
  /** Whether reduced motion finishes the motion: false for a `'nonmotion'` spring. */
  readonly #reduces: boolean

  /**
   * First-order-hold slope in value units per second, 0 when the target
   * holds still across the step. `armSlope` sets it immediately before the
   * `advance` that reads and clears it, with no user code between.
   */
  #slope = 0

  #config: SpringDefinition
  readonly #state: State

  #underdampedSolver: UnderdampedSolver | null = null
  #criticallyDampedSolver: CriticallyDampedSolver | null = null
  #overdampedSolver: OverdampedSolver | null = null
  #currentSolver: UnderdampedSolver | CriticallyDampedSolver | OverdampedSolver | null = null

  // Solver work waits for the next tick. #needsUpdate swaps solvers
  // after a reconfigure, and #needsReset re-anchors after a position or
  // velocity write.
  #needsUpdate = false
  #needsReset = false
  #running: boolean

  readonly #emitter: Emitter

  constructor(
    config: SpringDefinition,
    position: number,
    velocity: number,
    purpose: Purpose = 'motion',
  ) {
    super()
    this.#reduces = purpose === 'motion'
    this.#config = config
    this.#state = new State(config, position, velocity)
    this.#emitter = new Emitter()
    this.#running = !this.#state.isResting

    this.#updateSolver()
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
    // Solved on read, since the closed forms are time-invariant. Follower
    // chains disturb every motion every frame, so eager upkeep would cost an
    // unread bisection per motion per frame.
    return this.#config.computeTimeRemaining(this.#state)
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
    this.advance(dt)

    if (emit) {
      this.endFrame()
    } else {
      this.#reconcileRunning()
    }
  }

  /**
   * Makes the next `advance` integrate against a target moving at `slope`
   * value units per second instead of holding still. The owner calls it
   * with the step's new target already assigned and the position still
   * measured from the old one, so the step ends measured from the new
   * target. Only the next `advance` reads it.
   */
  armSlope(slope: number) {
    this.#slope = slope
  }

  /**
   * Advances the simulation and emits nothing. The tick pass advances
   * every motion through this, then delivers events with `endFrame`. The
   * synchronous `tick` wraps the two.
   *
   * A pending slope from `armSlope` makes the step one affine transform
   * around the unchanged solver. With the target at `p(t) = p0 + g*t`, the
   * displacement u = x - p(t) obeys the homogeneous equation shifted by the
   * constant u_ss = -(2*zeta/wn)*g = -(damping/tension)*g. The solver ticks
   * w = u - u_ss exactly, and the results shift back. u is measured from
   * the moving target, which the armer already assigned, so the step ends
   * on it with no rebase arithmetic. With g = 0 the step takes the plain
   * path, so a motion never armed steps bit-exactly like an isolated
   * spring.
   */
  advance(dt: number) {
    invariant(this.#currentSolver, 'Cannot tick a disposed motion')

    const g = this.#slope
    if (g !== 0) {
      this.#slope = 0
      const state = this.#state
      const shift = (this.#config.damping / this.#config.tension) * g
      state.position += shift
      state.velocity -= g
      // Re-anchor from the shifted state now and again next step. The
      // slope-space anchor is wrong for any other frame.
      if (this.#needsUpdate) {
        this.#updateSolver()
        this.#needsUpdate = false
      } else {
        this.#currentSolver.configure()
      }

      this.#currentSolver.tick(dt)

      state.position -= shift
      state.velocity += g
      this.#needsReset = true
      if (state.isResting) {
        state.position = 0
        state.velocity = 0
      }
      return
    }

    if (this.#needsUpdate) {
      this.#updateSolver()

      this.#needsUpdate = false
      this.#needsReset = false
    } else if (this.#needsReset) {
      this.#currentSolver.configure()

      this.#needsReset = false
    }

    this.#currentSolver.tick(dt)

    if (this.#state.isResting) {
      // Snap exactly to the target at rest. The deferred reset re-anchors
      // the solver if something disturbs the spring again.
      this.#state.position = 0
      this.#state.velocity = 0
      this.#needsReset = true
    }
  }

  /**
   * Emits the frame's `update`, then reconciles `stop` and `start`. The
   * tick pass calls this after every motion advanced, in the order the
   * motions first advanced, so update callbacks read frame-final values
   * everywhere.
   */
  endFrame() {
    this.#emitter.emit('update')
    this.#reconcileRunning()
  }

  // Reads state fresh because an update callback can displace the motion
  // again, and a cached boolean would emit a false 'stop'.
  #reconcileRunning() {
    if (this.#state.isResting) {
      if (this.#running) {
        this.#running = false
        this.#emitter.emit('stop')
      }
    } else if (!this.#running) {
      this.#running = true
      this.#emitter.emit('start')
    }
  }

  /**
   * Puts the motion at rest on the target and emits nothing. The next
   * `endFrame` delivers `update`, plus `stop` if it was moving. A
   * follower jumps through this mid-tick, so its listeners wait for the
   * settle sweep.
   */
  rest() {
    this.#state.position = 0
    this.#state.velocity = 0
    this.#needsReset = true
  }

  /** Ends the motion at the target at once and emits `update`, plus `stop` if it was moving. */
  finish() {
    this.rest()
    this.tick(0)
  }

  /**
   * Finishes the motion when reduced motion turns on, unless its purpose
   * is `'nonmotion'`. A motion already at rest on its target stays
   * silent. A leader's finish can jump its followers before the change
   * reaches them, and they must not emit twice.
   */
  applyReducedMotion(reduced: boolean) {
    if (!reduced || !this.#reduces) return
    const state = this.#state
    if (!this.#running && state.position === 0 && state.velocity === 0) return
    this.finish()
  }

  /**
   * The shock signal for the sub-step controller, read by a follower's
   * `plan` from its leader: the deviation from the quasi-steady tracking
   * manifold x = -(damping/tension) * v, where damping/tension is
   * 2*zeta/wn. It is near zero while chasing a smoothly moving target at
   * any speed, the full displacement after a target teleport, and
   * (damping/tension) * |v| after a fling from rest.
   */
  manifoldDeviation() {
    const config = this.#config
    return Math.abs(this.#state.position + (config.damping / config.tension) * this.#state.velocity)
  }

  /**
   * Newton's second law for the damped spring, `a = -(k*x + c*v) / m`,
   * with x the displacement from the target. Like position and velocity,
   * it is exact from the state and the config.
   */
  get acceleration() {
    const config = this.#config
    return (
      -(config.tension * this.#state.position + config.damping * this.#state.velocity) / config.mass
    )
  }

  /** A spring's slope never changes at a moment known in advance. */
  kinksWithin(_dt: number) {
    return false
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
