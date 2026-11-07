import { SpringDefinition } from './config.ts'
import type { MotionSet } from './motion-set.ts'
import { SpringMotion } from './spring-motion.ts'
import { type SpringSource, SpringSourceSymbol, isSpringSource } from './spring-source.ts'
import type { TargetedSource, TargetedSourceApi } from './kinematic-source.ts'
import {
  type FollowEdge,
  MANIFOLD_GATE,
  TargetTrail,
  registerBacking,
  resolveLeaderMotions,
} from './follow-graph.ts'
import { invariant, RESOLVED } from './util.ts'

/**
 * What a spring can animate toward. A number is a fixed target. A
 * `SpringSource` (another spring, or a value derived from one with
 * `mapSpring`) is a live value that the spring follows.
 */
export type SpringTarget = number | SpringSource

/**
 * What a spring animates, which decides whether reduced motion applies.
 * `'motion'` moves something on screen, such as position, scale, or
 * rotation, and snaps to its target under reduced motion. `'nonmotion'`
 * moves nothing, such as a cross-fade, a color, a blur, or a number that
 * never reaches the screen, and keeps animating under reduced motion.
 * Fixed at creation. Read it back from `Spring.purpose`.
 */
export type Purpose = 'motion' | 'nonmotion'

/**
 * One animated number, driven toward its target with damped spring
 * motion. Create springs with `SpringSystem.createSpring`. A spring moves
 * only when its system advances it.
 *
 * Reads return the exact, unrounded simulated state. Numeric writes
 * (`target`, `value`, `velocity`, `jumpTo`) throw on `NaN` or an
 * infinity. See https://github.com/tkofh/coily/blob/main/PRECISION.md
 * for the numerical contract.
 */
export class Spring implements TargetedSource {
  /** Brands the spring as a `TargetedSource` whose api is the spring itself. */
  get [SpringSourceSymbol](): TargetedSourceApi<number> {
    // Registered lazily: an entry per creation made major GCs walk every
    // spring and slowed creation 8x. Every follow path reads this api
    // before resolving leaders, so resolution always finds the entry.
    registerBacking(this, this.#motion)
    return this
  }

  #target: number
  #config: SpringDefinition
  readonly #purpose: Purpose
  readonly #motion: SpringMotion
  readonly #motions: MotionSet

  #leader: SpringSource | null = null
  #unsubLeader: (() => void) | null = null

  #settled: Promise<void> | null = null
  #resolveSettled: (() => void) | null = null
  #disposed = false

  constructor(
    motions: MotionSet,
    value: number,
    config?: SpringDefinition,
    purpose: Purpose = 'motion',
  ) {
    invariant(Number.isFinite(value), 'Spring value must be a finite number')
    invariant(
      purpose === 'motion' || purpose === 'nonmotion',
      "Spring purpose must be 'motion' or 'nonmotion'",
    )
    this.#motions = motions
    this.#config = config ?? SpringDefinition.default
    this.#target = value
    this.#purpose = purpose
    // The motion's purpose keeps a 'nonmotion' spring running when reduced
    // motion turns on. The setters keep its own writes animated.
    this.#motion = new SpringMotion(this.#config, 0, 0, purpose)
  }

  /**
   * The value the spring is animating toward. While following a source,
   * reads return the source's value as of its last update.
   *
   * Assignment accepts any `SpringTarget`:
   * - A number retargets smoothly, keeping the current value and velocity.
   *   It also ends any following.
   * - A `SpringSource` (a `Spring`, or a value derived with `mapSpring`)
   *   makes this spring follow the source's live value.
   *
   * Under reduced motion, retargets apply instantly unless `purpose` is
   * `'nonmotion'`.
   */
  get target(): number {
    return this.#target
  }

  set target(value: SpringTarget) {
    this.#assertLive()
    if (typeof value === 'number') {
      // Checked before unfollowing, so a rejected write keeps the follow.
      invariant(Number.isFinite(value), 'Spring target must be a finite number')
      this.#unfollow()
      this.#setTarget(value)
    } else {
      invariant(isSpringSource(value), 'Spring target must be a number or a SpringSource')
      const current = value[SpringSourceSymbol].value
      invariant(
        typeof current === 'number',
        'A spring can only follow a scalar SpringSource; derive one from a composite with mapSpring',
      )
      // Checked before following, so a rejected source keeps the old follow.
      invariant(Number.isFinite(current), 'Spring target must be a finite number')
      this.#follow(value as SpringSource)
    }
  }

  /**
   * The current animated value: the target plus the remaining
   * displacement.
   *
   * Writing displaces the spring. It keeps its target, springs back from
   * the written value, and notifies update listeners synchronously.
   * Writing the current value is a no-op. Under reduced motion, a write
   * jumps value and target together unless `purpose` is `'nonmotion'`.
   */
  get value() {
    return this.#target + this.#motion.position
  }

  set value(value: number) {
    this.#assertLive()
    invariant(Number.isFinite(value), 'Spring value must be a finite number')
    if (this.#motions.reduced && this.#purpose === 'motion') {
      if (value !== this.value) {
        this.jumpTo(value)
      }
      return
    }

    const position = value - this.#target
    if (position !== this.#motion.position) {
      this.#motions.add(this.#motion)
      this.#motion.position = position
      this.#motion.tick(0)
    }
  }

  /**
   * The current velocity, in value units per second.
   *
   * Writing flings the spring from its current value, and it settles back
   * to the target. Under reduced motion, the write is ignored unless
   * `purpose` is `'nonmotion'`.
   */
  get velocity() {
    return this.#motion.velocity
  }

  set velocity(value: number) {
    this.#assertLive()
    invariant(Number.isFinite(value), 'Spring velocity must be a finite number')
    if (this.#motions.reduced && this.#purpose === 'motion') return

    this.#motions.add(this.#motion)
    this.#motion.velocity = value
  }

  /**
   * The current acceleration, in value units per second squared.
   * Read-only, because stiffness and friction derive it from the current
   * displacement and velocity. To fling the spring, write `velocity`.
   */
  get acceleration() {
    return this.#motion.acceleration
  }

  /**
   * What the spring animates, fixed at creation. Under reduced motion, a
   * `'motion'` spring snaps to its target and a `'nonmotion'` spring keeps
   * animating. See `Purpose`.
   */
  get purpose(): Purpose {
    return this.#purpose
  }

  /**
   * The spring's `SpringDefinition`: the one it was created with or last
   * assigned, otherwise `SpringDefinition.default`. Following a source
   * never changes it.
   *
   * Assigning reconfigures the spring in place, keeping value and
   * velocity, so mid-flight changes stay smooth. `null` reverts to the
   * default.
   */
  get config(): SpringDefinition {
    return this.#config
  }

  /** The config's mass. */
  get mass() {
    return this.#config.mass
  }

  /** The config's tension (stiffness). */
  get tension() {
    return this.#config.tension
  }

  /** The config's damping (friction). */
  get damping() {
    return this.#config.damping
  }

  /** The config's damping ratio. */
  get dampingRatio() {
    return this.#config.dampingRatio
  }

  /** The config's precision: decimal places of the resting threshold. */
  get precision() {
    return this.#config.precision
  }

  /** The config's arrival multiplier, applied to the velocity at each target crossing. */
  get arrival() {
    return this.#config.arrival
  }

  set config(value: SpringDefinition | null) {
    this.#assertLive()
    const next = value ?? SpringDefinition.default
    if (this.#config === next) return

    this.#config = next
    this.#motion.configure(next)
    if (!this.#motion.isResting) {
      this.#motions.add(this.#motion)
    }
  }

  /**
   * The time until the spring rests, in ms, solved from the motion: 0
   * while resting, `Infinity` when it never settles. The spring rests at
   * the first tick at or after this time. A bouncy spring can rest up to
   * one oscillation earlier, when a frame samples a low point of the
   * bounce. With `arrival: 0`, the time is capped at the first target
   * crossing, exact to the ms.
   */
  get timeRemaining() {
    return this.#motion.timeRemaining
  }

  /**
   * Whether the spring's remaining motion is inside its resting
   * threshold. Resting springs cost nothing until the next write. See
   * https://github.com/tkofh/coily/blob/main/PRECISION.md for the rest
   * test.
   */
  get isResting() {
    return this.#motion.isResting
  }

  /**
   * A promise that resolves when the spring next rests or is disposed.
   * It is already resolved while the spring rests and after dispose.
   * Retargeting mid-flight extends the wait.
   *
   * @example
   * ```ts
   * spring.target = 300
   * await spring.settled
   * // the spring is at 300 and resting
   * ```
   */
  get settled(): Promise<void> {
    if (this.#disposed || this.#motion.isResting) return RESOLVED

    this.#settled ??= new Promise((resolve) => {
      this.#resolveSettled = resolve
      const unsubscribe = this.onStop(() => {
        unsubscribe()
        this.#settled = null
        this.#resolveSettled = null
        resolve()
      })
    })

    return this.#settled
  }

  /**
   * Snaps target and value to `value` and zeroes the velocity, with no
   * animation. Listeners fire synchronously: `update`, plus `stop` if the
   * spring was moving.
   */
  jumpTo(value: number) {
    this.#assertLive()
    invariant(Number.isFinite(value), 'Spring value must be a finite number')
    this.#target = value
    this.#motion.finish()
  }

  /**
   * Releases the spring permanently. It stops following, detaches
   * followers (each keeps its current target), resolves `settled`, and
   * notifies dispose listeners. Calling it again is a no-op.
   *
   * A disposed spring keeps its final value readable. Writes throw.
   */
  dispose() {
    if (this.#disposed) return
    this.#disposed = true

    if (this.#resolveSettled) {
      this.#resolveSettled()
      this.#settled = null
      this.#resolveSettled = null
    }

    if (this.#unsubLeader) {
      this.#unsubLeader()
      this.#unsubLeader = null
      this.#leader = null
    }

    this.#motions.remove(this.#motion)
    // Disposing the motion emits 'dispose', which detaches any followers.
    this.#motion.dispose()
  }

  /**
   * Subscribes to value changes: every tick the spring moves, plus
   * synchronous `value` writes and `jumpTo` calls. Returns an unsubscribe
   * function.
   */
  onUpdate(callback: () => void) {
    return this.#motion.onUpdate(callback)
  }

  /**
   * Subscribes to the spring leaving rest. `start` and `stop` always
   * alternate, and retargeting mid-flight fires neither. Returns an
   * unsubscribe function.
   */
  onStart(callback: () => void) {
    return this.#motion.onStart(callback)
  }

  /**
   * Subscribes to the spring coming to rest, whether by settling or by
   * `jumpTo`. Always alternates with `start`. Returns an unsubscribe
   * function.
   */
  onStop(callback: () => void) {
    return this.#motion.onStop(callback)
  }

  /** Subscribes to `dispose`, which fires once. Returns an unsubscribe function. */
  onDispose(callback: () => void) {
    return this.#motion.onDispose(callback)
  }

  #assertLive() {
    invariant(!this.#disposed, 'Cannot write to a disposed spring')
  }

  #setTarget(value: number) {
    // Also guards followed sources: a map yielding NaN throws here.
    invariant(Number.isFinite(value), 'Spring target must be a finite number')
    if (value !== this.#target) {
      if (this.#motions.reduced && this.#purpose === 'motion') {
        this.jumpTo(value)
        return
      }

      this.#motions.add(this.#motion)
      const current = this.value
      this.#target = value
      this.#motion.position = current - this.#target
      // Re-anchor the solver silently, because the value did not change.
      this.#motion.tick(0, false)
    }
  }

  #follow(source: SpringSource) {
    this.#unsubLeader?.()
    this.#leader = source

    const api = source[SpringSourceSymbol]
    const unsubUpdate = api.onUpdate(() => {
      this.#setTarget(api.value)
    })
    const unsubDispose = api.onDispose(() => {
      this.#unfollow()
    })
    // The edge mirrors the update subscription for the system's ordering,
    // and `recouple` repeats the handler's retarget. A foreign source
    // resolves to no leaders and couples through the emitter alone.
    const leaders = resolveLeaderMotions(source)
    if (leaders.length > 0) {
      const edge: FollowEdge = {
        follower: this.#motion,
        leaders,
        cyclic: false,
        trail: new TargetTrail(0),
        recouple: (h) => {
          if (this.#motions.reduced && this.#purpose === 'motion') {
            const value = api.value
            invariant(Number.isFinite(value), 'Spring target must be a finite number')
            if (value === this.#target) return
            // `#setTarget`'s jump without its events. Listeners must not
            // run mid-advance, so `endFrame` emits in the settle sweep.
            this.#target = value
            this.#motions.add(this.#motion)
            this.#motion.rest()
            return
          }
          // No slope in a cycle, where delayed feedback acts as negative
          // damping and a first-order hold destabilizes it. None on an
          // arrival spring, whose crossings are closed-form only against a
          // held target. None in a zero-length step, which must rebase
          // exactly.
          if (edge.cyclic || h === 0 || this.#config.arrival !== 1) {
            this.#setTarget(api.value)
            return
          }
          const value = api.value
          invariant(Number.isFinite(value), 'Spring target must be a finite number')
          const previous = this.#target
          if (value === previous) return
          this.#motions.add(this.#motion)
          // Only tick-path changes reach this delta, since synchronous
          // writes already stepped through the emitter. The position stays
          // measured from the old target until the sloped advance rebases it.
          this.#target = value
          this.#motion.armSlope((value - previous) / h)
        },
        plan: (dt) => {
          const trail = edge.trail
          const d = trail.observe(this.#target)

          // History covers smooth motion. A leader knocked off its manifold
          // (teleported or flung) escalates with its own kinematic bound
          // first. The bound and gate are in leader units: exact for a
          // direct follow, assuming a slope near 1 through map code.
          let dHat = Math.abs(d)
          let error = Math.abs(trail.curvature) / 8
          for (const leader of leaders) {
            // History misses a scheduled kink (a ramp arriving mid-frame),
            // which a slope would smear over the frame. Take the cap.
            if (leader.kinksWithin(dt)) return Number.POSITIVE_INFINITY
            if (leader.manifoldDeviation() > MANIFOLD_GATE * Math.abs(d)) {
              const accel = Math.abs(leader.acceleration)
              const speed = Math.abs(leader.velocity)
              dHat = Math.max(dHat, speed * dt + 0.5 * accel * dt * dt)
              error = Math.max(error, (accel * dt * dt) / 8)
            }
          }

          // Coupling finer than the follower's resting quantum buys nothing.
          const tol = Math.max(this.#config.restingMagnitude, this.#motions.couplingTolerance)
          // A held target (cycles, arrival) leaves half a sub-step of leader
          // travel as error, linear in the move. A slope leaves only the
          // curvature residual, which shrinks with the sub-step squared.
          return edge.cyclic || this.#config.arrival !== 1
            ? Math.ceil(dHat / (2 * tol))
            : Math.ceil(Math.sqrt(error / tol))
        },
      }
      this.#motions.graph.addEdge(edge)
      this.#unsubLeader = () => {
        unsubUpdate()
        unsubDispose()
        this.#motions.graph.removeEdge(this.#motion)
      }
      this.#setTarget(api.value)
      // Anchor the estimator on the target the follow just synced, so
      // the first delta in plan measures leader movement, not wiring.
      edge.trail.anchor(this.#target)
      return
    }
    this.#unsubLeader = () => {
      unsubUpdate()
      unsubDispose()
      this.#motions.graph.removeEdge(this.#motion)
    }

    this.#setTarget(api.value)
  }

  #unfollow() {
    if (!this.#leader) return

    this.#unsubLeader!()
    this.#unsubLeader = null
    this.#leader = null
  }
}
