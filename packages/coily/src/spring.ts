import { SpringConfig } from './config.ts'
import type { MotionSet } from './motion-set.ts'
import { Motion } from './motion.ts'

export interface SpringWithOffset {
  spring: Spring
  offset?: number | undefined
}

export type SpringTarget = number | Spring | SpringWithOffset

interface DisplacedSpringPosition {
  target?: SpringTarget | undefined
  value?: number | undefined
}

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

const RESOLVED = Promise.resolve()

export class Spring {
  #target: number
  /** Explicitly assigned config, or `null` to inherit from the leader (or the default). */
  #override: SpringConfig | null
  /** Cached effective config — always what the motion is currently using. */
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
        numericTarget =
          normalized.spring.#target + normalized.spring.#motion.position + normalized.offset
        value = position.value ?? numericTarget
      } else {
        numericTarget = (position.target as number | undefined) ?? position.value ?? 0
        value = position.value ?? numericTarget
      }
    }

    // Reduced motion: the suppressed animation would end at the target, so
    // the spring is simply created there.
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
        this.#setTarget(this.#leader!.#target + this.#leader!.#motion.position + this.#offset)
      })
    }
  }

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

  get value() {
    return this.#target + this.#motion.position
  }

  set value(value: number) {
    if (this.#motions.reduced) {
      // Honoring the written position is not motion — what gets skipped is
      // the spring-back animation, so the value becomes the new resting point.
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

  get velocity() {
    return this.#motion.velocity
  }

  set velocity(value: number) {
    // A velocity impulse is pure motion — ignored under reduced motion.
    if (this.#motions.reduced) return

    this.#motions.add(this.#motion)
    this.#motion.velocity = value
  }

  get config() {
    return this.#resolved
  }

  get mass() {
    return this.#resolved.mass
  }

  get tension() {
    return this.#resolved.tension
  }

  get damping() {
    return this.#resolved.damping
  }

  get dampingRatio() {
    return this.#resolved.dampingRatio
  }

  get precision() {
    return this.#resolved.precision
  }

  set config(value: SpringConfig | null) {
    this.#override = value
    this.#applyConfig(value ?? (this.#leader ? this.#leader.#resolved : SpringConfig.default))
  }

  get timeRemaining() {
    return this.#motion.timeRemaining
  }

  get isResting() {
    return this.#motion.isResting
  }

  /**
   * Resolves when the spring next comes to rest — immediately if it is
   * already resting. The same promise is returned for the duration of a
   * motion cycle, and retargeting mid-flight extends the wait: it resolves
   * only at true rest. Disposing the spring resolves a pending promise.
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

  jumpTo(value: number) {
    this.#target = value
    this.#motion.finish()
  }

  dispose() {
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

    // Detach followers so they don't reference a disposed spring. Each keeps
    // its current config and target, and can be retargeted normally.
    // Set iteration tolerates each follower removing itself as it detaches.
    for (const follower of this.#followers) {
      follower.#unfollow()
    }

    this.#motions.remove(this.#motion)
    this.#motion.dispose()
  }

  onUpdate(callback: () => void) {
    return this.#motion.onUpdate(callback)
  }

  onStart(callback: () => void) {
    return this.#motion.onStart(callback)
  }

  onStop(callback: () => void) {
    return this.#motion.onStop(callback)
  }

  #setTarget(value: number) {
    if (value !== this.#target) {
      if (this.#motions.reduced) {
        this.jumpTo(value)
        return
      }

      this.#motions.add(this.#motion)
      const rawValue = this.#target + this.#motion.position
      this.#target = value
      this.#motion.position = rawValue - this.#target
      // Re-baseline without emitting `update`: a retarget preserves the
      // current value, so consumers hear about it on the next real tick.
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
      this.#setTarget(this.#leader!.#target + this.#leader!.#motion.position + this.#offset)
    })

    this.#setTarget(leader.#target + leader.#motion.position + offset)
  }

  #unfollow() {
    if (!this.#leader) return

    this.#unsubLeader!()
    this.#unsubLeader = null
    this.#leader.#followers.delete(this)
    this.#leader = null
    this.#offset = 0

    if (this.#override === null) {
      // Snapshot the inherited config so the spring keeps behaving the same,
      // decoupled from the ex-leader's future config changes.
      this.#override = this.#resolved
    }
  }

  #applyConfig(next: SpringConfig) {
    if (this.#resolved === next) return

    this.#resolved = next
    this.#motion.configure(next)
    this.#motions.add(this.#motion)

    for (const follower of this.#followers) {
      if (follower.#override === null) {
        follower.#applyConfig(next)
      }
    }
  }
}
