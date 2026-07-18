import { SpringDefinition } from './config.ts'
import { Emitter } from './emitter.ts'
import type { FollowEdge } from './follow-graph.ts'
import { State } from './state.ts'
import { CriticallyDampedSolver, OverdampedSolver, UnderdampedSolver } from './solver.ts'
import { invariant } from './util.ts'

let nextMotionId = 0

/**
 * One spring simulation in displacement space: position is measured from
 * the target (0 means settled), so retargeting is a rebase performed by
 * the owning `Spring`. Picks the closed-form solver for the config's
 * damping regime and emits update/start/stop/dispose events.
 */
export class Motion {
  /** Monotone creation id: breaks ties wherever motions need a deterministic order. */
  readonly _id = nextMotionId++

  /** Tick-pass marker written by `MotionSet` so a motion re-added mid-pass isn't ticked twice. */
  _pass = 0

  /**
   * Frame marker written by `MotionSet`: sub-steps share one frame, and
   * the first advance in it queues the motion for the settle sweep.
   */
  _frame = 0

  /**
   * Dependency rank written by `FollowGraph`: motions the follow graph
   * touches count up from 0, leaders before followers; -1 marks a motion
   * outside the graph.
   */
  _rank = -1

  /**
   * The edge this motion follows through, or null. Written by
   * `FollowGraph` on edge add/remove so the tick's hot loop reads a
   * field instead of a map.
   */
  _edge: FollowEdge | null = null

  /**
   * A first-order-hold ramp slope in value units per second, armed by a
   * ramped `recouple` immediately before the `_advance` that consumes
   * it (read-and-clear; no user code runs between the two). 0 means the
   * target holds still across the step — every path but a ramped
   * recouple.
   */
  _ramp = 0

  /**
   * The edges reading this motion, or null when none. Written by
   * `FollowGraph` with the rank cache, so it can lag a mid-pass edge
   * change until the next recompute; the tick tolerates stale entries.
   */
  _followers: FollowEdge[] | null = null

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
  #running: boolean

  readonly #emitter: Emitter

  constructor(config: SpringDefinition, position: number, velocity: number) {
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
    this._advance(dt)

    if (emit) {
      this._settleFrame()
    } else {
      this.#reconcileRunning()
    }
  }

  /**
   * Advances the simulation and emits nothing. The tick pass advances
   * every motion through this, then delivers the frame's events with
   * `_settleFrame`; the synchronous `tick` wraps the two.
   *
   * A pending `_ramp` integrates the step against a target moving at
   * that slope instead of holding still: one affine transform around
   * the unchanged solver. With the target at `p(t) = p0 + g*t`, the
   * displacement u = x - p(t) obeys the homogeneous equation shifted by
   * the constant u_ss = -(2*zeta/wn)*g = -(damping/tension)*g, so the
   * solver ticks w = u - u_ss exactly and the results shift back.
   * Measuring u from the moving target makes the ramp endpoint and the
   * new target coincide — the armer assigns the target, no rebase
   * arithmetic exists. The ramp is an argument of the step, never
   * persistent solver state: g = 0 takes the plain step below, so a
   * motion that never ramps steps bit-exactly like an isolated spring.
   */
  _advance(dt: number) {
    invariant(this.#currentSolver, 'Cannot tick a disposed motion')

    const g = this._ramp
    if (g !== 0) {
      this._ramp = 0
      const state = this.#state
      const shift = (this.#config.damping / this.#config.tension) * g
      state.position += shift
      state.velocity -= g
      // Anchor in ramp space from the shifted state: unconditionally,
      // and again next step — the ramp-space anchor is wrong for any
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
  _settleFrame() {
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

  finish() {
    this.position = 0
    this.velocity = 0
    this.tick(0)
  }

  /**
   * The sub-step controller's shock signal, read by a follower's `plan`
   * with this motion as its leader: deviation from the quasi-steady
   * tracking manifold x = -(damping/tension) * v, where damping/tension
   * is 2*zeta/wn. Near zero while chasing any smoothly moving target at
   * any speed; the full displacement after a target teleport;
   * (damping/tension) * |v| after a fling.
   */
  _manifoldDeviation() {
    const config = this.#config
    return Math.abs(this.#state.position + (config.damping / config.tension) * this.#state.velocity)
  }

  /** Acceleration from current state, for `plan`'s kinematic bound on a shock frame. */
  _acceleration() {
    const config = this.#config
    return (
      -(config.tension * this.#state.position + config.damping * this.#state.velocity) / config.mass
    )
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
