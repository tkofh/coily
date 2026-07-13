import { SpringDefinition } from './config.ts'
import type { MotionSet } from './motion-set.ts'
import { Motion } from './motion.ts'
import {
  type SpringSource,
  type SpringSourceApi,
  SpringSourceSymbol,
  isSpringSource,
} from './spring-source.ts'
import { invariant } from './util.ts'

/**
 * What a spring can animate toward: a fixed number, or a `SpringSource`
 * — another spring, or a value derived from one with `mapSpring` —
 * whose live value the spring follows.
 */
export type SpringTarget = number | SpringSource

// Shared so resting and disposed springs don't allocate a promise per read.
const RESOLVED = Promise.resolve()

/**
 * One animated number, driven toward its target with damped spring
 * motion. Create springs with `SpringSystem.createSpring`; the owning
 * system advances them, so a spring only moves while its system runs.
 *
 * Reads return the exact simulated state; nothing is rounded. Numeric
 * writes — `target`, `value`, `velocity`, `jumpTo` — require finite
 * numbers: `NaN` or an infinity throws rather than poisoning the
 * simulation. See
 * https://github.com/tkofh/coily/blob/main/PRECISION.md for the
 * numerical contract.
 */
export class Spring implements SpringSource {
  /** Brands the spring as a `SpringSource` whose api is the spring itself. */
  get [SpringSourceSymbol](): SpringSourceApi<number> {
    return this
  }

  #target: number
  #config: SpringDefinition
  readonly #motion: Motion
  readonly #motions: MotionSet

  #leader: SpringSource | null = null
  #unsubLeader: (() => void) | null = null

  #settled: Promise<void> | null = null
  #resolveSettled: (() => void) | null = null
  #disposed = false

  constructor(motions: MotionSet, value: number, config?: SpringDefinition) {
    invariant(Number.isFinite(value), 'Spring value must be a finite number')
    this.#motions = motions
    this.#config = config ?? SpringDefinition.default
    this.#target = value
    this.#motion = new Motion(this.#config, 0, 0)
  }

  /**
   * The value the spring is animating toward. While following a source,
   * reads return the source's value as of its last update.
   *
   * Assignment accepts any `SpringTarget`:
   * - A number retargets the spring. The current value and momentum carry
   *   over, so mid-flight retargets stay smooth. Assigning a number while
   *   following also stops the following.
   * - A `SpringSource` — a `Spring`, or a value derived with `mapSpring` —
   *   makes this spring follow the source's live value.
   *
   * Under reduced motion, retargets apply instantly.
   */
  get target(): number {
    return this.#target
  }

  set target(value: SpringTarget) {
    if (typeof value === 'number') {
      this.#unfollow()
      this.#setTarget(value)
    } else {
      invariant(isSpringSource(value), 'Spring target must be a number or a SpringSource')
      invariant(
        typeof value[SpringSourceSymbol].value === 'number',
        'A spring can only follow a scalar SpringSource; derive one from a composite with mapSpring',
      )
      this.#follow(value as SpringSource)
    }
  }

  /**
   * The current animated value: the target plus the remaining
   * displacement.
   *
   * Writing displaces the spring: it keeps its target and springs back
   * from the written value, notifying update listeners synchronously.
   * Writing the current value is a no-op. Under reduced motion a write
   * jumps the spring — target included — to the written value.
   */
  get value() {
    return this.#target + this.#motion.position
  }

  set value(value: number) {
    invariant(Number.isFinite(value), 'Spring value must be a finite number')
    if (this.#motions.reduced) {
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
   * Writing flings the spring: motion continues from the current value
   * with the written velocity, then settles back to the target. Under
   * reduced motion writes are ignored.
   */
  get velocity() {
    return this.#motion.velocity
  }

  set velocity(value: number) {
    invariant(Number.isFinite(value), 'Spring velocity must be a finite number')
    if (this.#motions.reduced) return

    this.#motions.add(this.#motion)
    this.#motion.velocity = value
  }

  /**
   * The spring's `SpringDefinition`: the one it was created with or last
   * assigned, otherwise `SpringDefinition.default`. Following a source
   * never changes it — how a spring chases its target is the spring's
   * own setting.
   *
   * Assigning a config reconfigures the spring in place — value and
   * velocity are preserved, so mid-flight reconfigures stay smooth.
   * Assigning `null` reverts to the default.
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

  /** The config's resting precision. */
  get precision() {
    return this.#config.precision
  }

  set config(value: SpringDefinition | null) {
    const next = value ?? SpringDefinition.default
    if (this.#config === next) return

    this.#config = next
    this.#motion.configure(next)
    if (!this.#motion.isResting) {
      this.#motions.add(this.#motion)
    }
  }

  /**
   * Estimated milliseconds until the spring rests: 0 while resting,
   * Infinity when undamped. The estimate carries a safety margin, so
   * actual rest usually lands earlier.
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
   * A promise that resolves when the spring next comes to rest — already
   * resolved while resting or after dispose. Retargeting mid-flight
   * extends the wait; disposing resolves it.
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
   * Snaps the spring to `value` with no animation: target and value both
   * become `value` and velocity clears. Listeners are notified
   * synchronously — `update`, plus `stop` if the spring was moving.
   */
  jumpTo(value: number) {
    invariant(Number.isFinite(value), 'Spring value must be a finite number')
    this.#target = value
    this.#motion.finish()
  }

  /**
   * Releases the spring permanently: stops following, detaches followers
   * (each keeps its current target), resolves `settled`, and notifies
   * dispose listeners. Calling it again is a no-op.
   *
   * A disposed spring keeps its final value readable; writes throw.
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
   * alternate; retargeting mid-flight fires neither. Returns an
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

  #setTarget(value: number) {
    // Guards followed sources too: a map that produces NaN mid-flight
    // throws here, at the moment of the poisoned retarget.
    invariant(Number.isFinite(value), 'Spring target must be a finite number')
    if (value !== this.#target) {
      if (this.#motions.reduced) {
        this.jumpTo(value)
        return
      }

      this.#motions.add(this.#motion)
      const current = this.value
      this.#target = value
      this.#motion.position = current - this.#target
      // Re-anchor the solver at the rebased displacement without emitting
      // an update: the spring's value hasn't changed.
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
    this.#unsubLeader = () => {
      unsubUpdate()
      unsubDispose()
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
