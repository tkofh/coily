import { SpringConfig } from './config.ts'
import type { MotionSet } from './motion-set.ts'
import { Motion } from './motion.ts'

/** A follow target: the spring to track, plus a constant offset. */
export interface SpringWithOffset {
  /** The spring whose live value to follow. */
  spring: Spring
  /**
   * Constant added to the leader's value, in value units.
   * @default 0
   */
  offset?: number | undefined
}

/**
 * What a spring can animate toward: a fixed number, another spring to
 * follow, or a spring plus a constant offset.
 */
export type SpringTarget = number | Spring | SpringWithOffset

interface DisplacedSpringPosition {
  /** The initial target. When omitted, the spring starts at rest at `value`. */
  target?: SpringTarget | undefined
  /**
   * The initial value. When omitted, the spring starts at the target.
   * Provide both `target` and `value` to create a spring already in
   * motion. Ignored under reduced motion: springs start at their target.
   */
  value?: number | undefined
}

/**
 * Where a spring starts: a plain number for a spring at rest at that
 * value, or a target/value pair for one created displaced or already
 * following another spring.
 */
export type SpringPosition = number | DisplacedSpringPosition

function normalizeTarget(
  target: SpringTarget | undefined,
): { spring: Spring; offset: number } | null {
  if (target instanceof Spring) return { spring: target, offset: 0 }
  if (
    typeof target === 'object' &&
    target !== null &&
    'spring' in target &&
    target.spring instanceof Spring
  ) {
    return { spring: target.spring, offset: target.offset ?? 0 }
  }
  return null
}

// Shared so resting and disposed springs don't allocate a promise per read.
const RESOLVED = Promise.resolve()

/**
 * One animated number, driven toward its target with damped spring
 * motion. Create springs with `SpringSystem.createSpring`; the owning
 * system advances them, so a spring only moves while its system runs.
 *
 * Reads return the exact simulated state; nothing is rounded. See
 * https://github.com/tkofh/coily/blob/main/PRECISION.md for the
 * numerical contract.
 */
export class Spring {
  #target: number
  #override: SpringConfig | null
  #resolved: SpringConfig
  readonly #motion: Motion
  readonly #motions: MotionSet
  readonly #followers = new Set<Spring>()

  #leader: Spring | null = null
  #offset = 0
  #unsubLeader: (() => void) | null = null

  #settled: Promise<void> | null = null
  #resolveSettled: (() => void) | null = null
  #disposed = false

  constructor(motions: MotionSet, position: SpringPosition, config?: SpringConfig) {
    this.#motions = motions

    let numericTarget: number
    let value: number
    let normalized: { spring: Spring; offset: number } | null = null

    if (typeof position === 'number') {
      numericTarget = position
      value = position
    } else {
      normalized = normalizeTarget(position.target)
      if (normalized) {
        numericTarget = normalized.spring.value + normalized.offset
        value = position.value ?? numericTarget
      } else {
        numericTarget = (position.target as number | undefined) ?? position.value ?? 0
        value = position.value ?? numericTarget
      }
    }

    if (motions.reduced) {
      value = numericTarget
    }

    this.#override = config ?? null
    this.#resolved = config ?? (normalized ? normalized.spring.#resolved : SpringConfig.default)

    this.#target = numericTarget
    this.#motion = new Motion(this.#resolved, value - numericTarget, 0)

    if (!this.#motion.isResting) {
      this.#motions.add(this.#motion)
    }

    if (normalized) {
      this.#leader = normalized.spring
      this.#offset = normalized.offset
      normalized.spring.#followers.add(this)
      this.#unsubLeader = normalized.spring.onUpdate(() => {
        this.#setTarget(this.#leader!.value + this.#offset)
      })
    }
  }

  /**
   * The value the spring is animating toward. While following another
   * spring, reads return the leader's value plus the offset, as of the
   * leader's last update.
   *
   * Assignment accepts any `SpringTarget`:
   * - A number retargets the spring. The current value and momentum carry
   *   over, so mid-flight retargets stay smooth. Assigning a number while
   *   following also stops the following.
   * - A `Spring` — or `{ spring, offset }` — makes this spring follow the
   *   leader's live value. Followers without a config of their own adopt
   *   the leader's.
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
      const normalized = normalizeTarget(value)!
      this.#follow(normalized.spring, normalized.offset)
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
    if (this.#motions.reduced) return

    this.#motions.add(this.#motion)
    this.#motion.velocity = value
  }

  /**
   * The spring's resolved `SpringConfig`: its own if one was assigned,
   * otherwise the leader's while following, otherwise
   * `SpringConfig.default`.
   *
   * Assigning a config reconfigures the spring in place — value and
   * velocity are preserved, so mid-flight reconfigures stay smooth.
   * Assigning `null` clears the spring's own config, reverting to the
   * default (or to the leader's, while following). Reconfiguring a leader
   * cascades to every follower without a config of its own.
   *
   * A follower that stops following keeps the leader config it had been
   * using as its own.
   */
  get config() {
    return this.#resolved
  }

  /** The resolved config's mass. */
  get mass() {
    return this.#resolved.mass
  }

  /** The resolved config's tension (stiffness). */
  get tension() {
    return this.#resolved.tension
  }

  /** The resolved config's damping (friction). */
  get damping() {
    return this.#resolved.damping
  }

  /** The resolved config's damping ratio. */
  get dampingRatio() {
    return this.#resolved.dampingRatio
  }

  /** The resolved config's resting precision. */
  get precision() {
    return this.#resolved.precision
  }

  set config(value: SpringConfig | null) {
    this.#override = value
    this.#applyConfig(value ?? (this.#leader ? this.#leader.#resolved : SpringConfig.default))
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
    this.#target = value
    this.#motion.finish()
  }

  /**
   * Releases the spring permanently: stops following, detaches followers
   * (each keeps its current target and config), resolves `settled`, and
   * notifies dispose listeners. Calling it again is a no-op.
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
    }
    if (this.#leader) {
      this.#leader.#followers.delete(this)
      this.#leader = null
    }

    for (const follower of this.#followers) {
      follower.#unfollow()
    }

    this.#motions.remove(this.#motion)
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

  #follow(leader: Spring, offset: number) {
    if (this.#unsubLeader) {
      this.#unsubLeader()
      this.#leader!.#followers.delete(this)
    }

    this.#leader = leader
    this.#offset = offset
    leader.#followers.add(this)

    if (this.#override === null) {
      this.#applyConfig(leader.#resolved)
    }

    this.#unsubLeader = leader.onUpdate(() => {
      this.#setTarget(this.#leader!.value + this.#offset)
    })

    this.#setTarget(leader.value + offset)
  }

  #unfollow() {
    if (!this.#leader) return

    this.#unsubLeader!()
    this.#unsubLeader = null
    this.#leader.#followers.delete(this)
    this.#leader = null
    this.#offset = 0

    if (this.#override === null) {
      // Adopt the inherited config as our own: unfollowing must not
      // visibly reconfigure the spring.
      this.#override = this.#resolved
    }
  }

  #applyConfig(next: SpringConfig) {
    if (this.#resolved === next) return

    this.#resolved = next
    this.#motion.configure(next)
    if (!this.#motion.isResting) {
      this.#motions.add(this.#motion)
    }

    for (const follower of this.#followers) {
      if (follower.#override === null) {
        follower.#applyConfig(next)
      }
    }
  }
}
