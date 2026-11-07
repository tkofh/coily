import { SpringDefinition } from './config.ts'
import { Emitter } from './emitter.ts'
import { Motion } from './motion.ts'
import { State } from './state.ts'
import { CriticallyDampedSolver, OverdampedSolver, UnderdampedSolver } from './solver.ts'
import type { Purpose } from './spring.ts'
import { invariant } from './util.ts'

/**
 * One spring simulation in displacement space: position is measured from
 * the target (0 means settled), so retargeting is a rebase performed by
 * the owning `Spring`. Picks the closed-form solver for the config's
 * damping regime and emits update/start/stop/dispose events.
 */
export class SpringMotion extends Motion {
  /** Whether reduced motion finishes the motion: false for a `'nonmotion'` spring. */
  readonly #reduces: boolean

  /**
   * A first-order-hold slope in value units per second, armed by
   * `armSlope` immediately before the `advance` that consumes it
   * (read-and-clear; no user code runs between the two). 0 means the
   * target holds still across the step.
   */
  #slope = 0

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
    // Solved from the live state on read: the closed forms are
    // time-invariant, so nothing needs maintaining per tick — chains of
    // followers disturb every motion every frame, and eager bookkeeping
    // here is a per-frame bisection nobody asked for.
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
   * every motion through this, then delivers the frame's events with
   * `endFrame`; the synchronous `tick` wraps the two.
   *
   * A pending slope from `armSlope` integrates the step against a target moving at
   * that slope instead of holding still: one affine transform around
   * the unchanged solver. With the target at `p(t) = p0 + g*t`, the
   * displacement u = x - p(t) obeys the homogeneous equation shifted by
   * the constant u_ss = -(2*zeta/wn)*g = -(damping/tension)*g, so the
   * solver ticks w = u - u_ss exactly and the results shift back.
   * Measuring u from the moving target makes the slope endpoint and the
   * new target coincide — the armer assigns the target, no rebase
   * arithmetic exists. The slope is an argument of the step, never
   * persistent solver state: g = 0 takes the plain step below, so a
   * motion never armed with a slope steps bit-exactly like an isolated
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
      // Anchor in slope space from the shifted state: unconditionally,
      // and again next step — the slope-space anchor is wrong for any
      // other frame.
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
      // Snap exactly to the target at rest; the deferred reset re-anchors
      // the solver if the spring is disturbed again.
      this.#state.position = 0
      this.#state.velocity = 0
      this.#needsReset = true
    }
  }

  /**
   * Emits the frame's `update`, then reconciles `stop`/`start`. The tick
   * pass calls this in dependency order after every motion has advanced,
   * so update callbacks read frame-final values everywhere.
   */
  endFrame() {
    this.#emitter.emit('update')
    this.#reconcileRunning()
  }

  // Reads state fresh rather than caching around the update emit: an
  // update callback can re-displace the motion, and a stale boolean
  // would emit a bogus 'stop'.
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

  /** Ends the motion at the target at once and emits the update. */
  finish() {
    this.position = 0
    this.velocity = 0
    this.tick(0)
  }

  /** Finishes the motion when reduced motion turns on, unless its purpose is `'nonmotion'`. */
  applyReducedMotion(reduced: boolean) {
    if (reduced && this.#reduces) this.finish()
  }

  /**
   * The sub-step controller's shock signal, read by a follower's `plan`
   * with this motion as its leader: deviation from the quasi-steady
   * tracking manifold x = -(damping/tension) * v, where damping/tension
   * is 2*zeta/wn. Near zero while chasing any smoothly moving target at
   * any speed; the full displacement after a target teleport;
   * (damping/tension) * |v| after a fling.
   */
  manifoldDeviation() {
    const config = this.#config
    return Math.abs(this.#state.position + (config.damping / config.tension) * this.#state.velocity)
  }

  /**
   * Newton's second law for the damped spring, `a = -(k*x + c*v) / m`,
   * with x the displacement from the target. Exact from state and
   * config, like position and velocity.
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
